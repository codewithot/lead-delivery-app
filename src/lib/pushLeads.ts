import {
  PrismaClient,
  type Job,
  type UserSettings,
  type Property,
  type Contact,
} from "@prisma/client";
import axios from "axios";
import { rateLimitedRequest } from "./rateLimiter";
import { getValidAccessToken } from "./ghlClient";
import {
  ensureContactPropertyAssociation,
  toNumber,
  toFloat,
  normalizeYesNo,
  normalizeWorkingWithRealtor,
  normalizeMLSStatus,
  normalizeLiquidAssets,
  normalizeHouseholdIncome,
  normalizeLoanType,
  normalizedLoanType,
  buildTags,
  normalizePropertyType,
  parkingMapping,
  extractGhlId,
  normalizeFreeAndClear,
  normalizeLeadSource,
  findGhlContactByEmailOrPhone,
  findGhlPropertyByAddress,
  normalizeCountry,
  normalizePostalCode,
} from "./helper";
import { updateJobProgress } from "./jobProgress";
import {
  normalizeEmail,
  normalizePhone,
  normalizeAddress,
} from "./normalizers";
import { Prisma } from "@prisma/client";
import { createLogger } from "@/lib/secureLogger";

const logger = createLogger('PushLeads');
const prisma = new PrismaClient();
const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const CUSTOM_OBJECT_KEY = "custom_objects.properties";
const API_VERSION = "2021-07-28";

// ✅ Payload type for dual-mode support
interface PushLeadsPayload {
  userId: string;

  // Daily queue mode fields
  contactId?: number;
  propertyIds?: number[];
  contact?: Contact;
  properties?: (Property & { owner: Contact | null })[];

  // Old webhook mode fields
  ingestedAt?: string;
  runId?: string;
  batchIndex?: number;
  batchSize?: number;
  totalBatches?: number;
}

/**
 * Check if contact already exists in local database
 * Uses normalized email and phone for matching
 */
async function findLocalContact(
  email: string | null | undefined,
  phone: string | null | undefined
): Promise<Contact | null> {
  if (!email && !phone) {
    return null;
  }

  const emailNorm = normalizeEmail(email);
  const phoneNorm = normalizePhone(phone);
  const orConditions: Prisma.ContactWhereInput[] = [];

  // ✅ Use normalized fields for exact matching
  if (emailNorm.normalized && emailNorm.isValid) {
    orConditions.push({
      emailNormalized: emailNorm.normalized,
    });
  }

  if (phoneNorm.normalized && phoneNorm.isValid) {
    orConditions.push({
      phoneNormalized: phoneNorm.normalized,
    });
  }

  if (orConditions.length === 0) {
    return null;
  }

  const contact = await prisma.contact.findFirst({
    where: { OR: orConditions },
  });

  return contact;
}
/**
 * Check if property already exists in local database
 * Uses normalized address for matching
 */
async function findLocalProperty(
  address: string | null | undefined
): Promise<Property | null> {
  if (!address) {
    return null;
  }

  const addressNorm = normalizeAddress(address);

  if (!addressNorm.normalized || !addressNorm.isValid) {
    return null;
  }

  // ✅ Use normalized field for exact matching
  const property = await prisma.property.findFirst({
    where: {
      addressNormalized: addressNorm.normalized,
    },
  });

  return property;
}
export async function pushLeadsForUser(job: Job) {
  logger.info(`▶ Starting job id=${job.id}, userId=${job.userId}`);
  console.debug(`Payload: ${JSON.stringify(job.payload)}`);

  // ========================================================================
  // STEP 1: Get user and settings
  // ========================================================================
  const user = await prisma.user.findUnique({
    where: { id: job.userId },
    include: { settings: true },
  });

  if (!user || !user.settings) {
    throw new Error("Missing user or user settings");
  }

  if (!user.locationId) {
    throw new Error("User has no GHL locationId configured");
  }

  const accessToken = await getValidAccessToken(user);
  const locationId = user.locationId;
  const settings = user.settings as UserSettings;

  logger.info(`🔑 Using OAuth token for user ${user.email || user.id}`);
  logger.info(`📍 Location ID: ${locationId}`);

  // ========================================================================
  // STEP 2: Determine total to process and batching strategy
  // ========================================================================
  const payload = job.payload as unknown as PushLeadsPayload;
  let preIdentifiedProps: (Property & { owner: Contact | null })[] = [];
  let totalToProcess = 0;
  let isPreIdentified = false;

  if (
    payload.properties &&
    Array.isArray(payload.properties) &&
    payload.properties.length > 0
  ) {
    logger.info(`📦 Daily queue mode: ${payload.properties.length} properties provided`);
    preIdentifiedProps = payload.properties;
    totalToProcess = preIdentifiedProps.length;
    isPreIdentified = true;
  } else {
    logger.info(`🔍 Webhook mode: calculating limits and count`);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const alreadyPushed = await prisma.property.count({
      where: {
        pushed: true,
        price: {
          gte: settings.priceMin ?? 0,
          lte: settings.priceMax ?? Number.MAX_SAFE_INTEGER,
        },
        postalCode: { in: settings.zipCodes },
        pushedAt: { gte: todayStart },
      },
    });

    const remainingLimit = Math.max(0, settings.planLimit - alreadyPushed);
    if (remainingLimit === 0) {
      logger.info("✔ Plan limit reached for today, skipping");
      return;
    }

    const foundCount = await prisma.property.count({
      where: {
        price: {
          gte: settings.priceMin ?? 0,
          lte: settings.priceMax ?? Number.MAX_SAFE_INTEGER,
        },
        postalCode: { in: settings.zipCodes },
        pushed: false,
      },
    });

    totalToProcess = Math.min(foundCount, remainingLimit);
    logger.info(`📊 Plan limit: ${settings.planLimit}, Remaining: ${remainingLimit}, Found: ${foundCount} properties. Will process: ${totalToProcess}`);
  }

  if (totalToProcess === 0) {
    logger.info("✔ No properties to process");
    return;
  }

  const contactIdMap: Record<number, string> = {};
  let pushedContactCount = 0;
  let pushedPropertyCount = 0;
  let associationCount = 0;

  // ✅ FIX: Fetch properties in Webhook mode or use preIdentifiedProps in Daily Queue mode
  const properties: (Property & { owner: Contact | null })[] = isPreIdentified
    ? preIdentifiedProps
    : await prisma.property.findMany({
      where: {
        price: {
          gte: settings.priceMin ?? 0,
          lte: settings.priceMax ?? Number.MAX_SAFE_INTEGER,
        },
        postalCode: { in: settings.zipCodes },
        pushed: false,
      },
      include: { owner: true },
      take: totalToProcess,
      orderBy: { createdAt: "asc" },
    });

  logger.info(
    `🔍 Processing ${properties.length} properties for job ${job.id} (Pre-identified: ${isPreIdentified})`
  );

  // Initialize progress tracking
  await updateJobProgress(job.id, {
    processed: 0,
    total: properties.length,
    status: `Found ${properties.length} properties to push`,
  }).catch((err) => console.warn("Progress update failed:", err));

  // ========================================================================
  // STEP 3: Identify unique contacts that need to be pushed
  // ========================================================================
  const contactsToPush = new Map<number, (typeof properties)[0]["owner"]>();

  for (const property of properties) {
    if (property.owner && !property.owner.pushed && property.ownerId) {
      contactsToPush.set(property.ownerId, property.owner);
    }
  }

  logger.info(`👥 Found ${contactsToPush.size} unique contacts to push`);

  // ✅ REMOVED: Lines 248-251 duplicate declarations deleted

  // ========================================================================
  // STEP 4: Push contacts first
  // ========================================================================
  for (const [contactId, contact] of contactsToPush) {
    // ✅ Fixed: Null check for contact
    if (!contact) {
      console.warn(`⚠️ Skipping contact ID ${contactId} - contact is null`);
      continue;
    }

    if (!contact.email && !contact.phone) {
      console.warn(
        `⚠️ Skipping contact ID ${contactId} - no email or phone number`
      );
      continue;
    }

    // ✅ NEW: Check local database first
    const localContact = await findLocalContact(contact.email, contact.phone);

    if (localContact?.ghlContactId) {
      logger.info(
        `✅ Found existing contact in local DB: ${localContact.ghlContactId} for contact ID ${contactId}`
      );
      contactIdMap[contactId] = localContact.ghlContactId;
      continue; // Skip GHL API call
    }

    // Then try to find existing contact in GHL (rate-limited)
    const existingGhlId = await rateLimitedRequest(() =>
      findGhlContactByEmailOrPhone(
        contact.email,
        contact.phone,
        accessToken,
        locationId
      )
    );

    if (existingGhlId) {
      logger.info(
        `✓ Found existing contact in GHL: ${existingGhlId} for contact ID ${contactId}`
      );
      contactIdMap[contactId] = existingGhlId;

      // Update our local DB with the GHL ID if we don't have it
      if (!contact.ghlContactId) {
        await prisma.contact.update({
          where: { id: contactId },
          data: { ghlContactId: existingGhlId },
        });
      }

      continue; // Skip creation attempt
    }

    // ✅ FIX Line 240: Added type annotation
    const property = properties.find((p: Property & { owner: Contact | null }) => p.ownerId === contactId);

    if (!property) {
      console.warn(
        `⚠️ Contact ID ${contactId} has no property in current batch, skipping`
      );
      continue;
    }

    let normalizedPool: "True" | "False" | null = null;
    if (property.pool) {
      const val = property.pool.toLowerCase();
      if (val === "yes" || val === "true") normalizedPool = "True";
      else if (val === "no" || val === "false") normalizedPool = "False";
    }

    const tagsArray = buildTags(property.tags, null);

    const contactPayload: Record<string, unknown> = {
      locationId: locationId,
      firstName: contact.firstName ?? undefined,
      lastName: contact.lastName ?? undefined,
      email: contact.email ?? undefined,
      phone: contact.phone ?? undefined,
      address1: property.streetAddress ?? undefined,
      tags: (tagsArray?.length ?? 0) > 0 ? tagsArray : undefined,
      city: property.city ?? undefined,
      country: normalizeCountry(property.country) ?? undefined,
      state: property.state ?? undefined,
      postalCode: normalizePostalCode(property.postalCode) ?? undefined,
      companyName: contact.companyName ?? undefined,
      source: "ProEdge",

      customFields: [
        { id: "bedrooms", value: property.bedrooms || "" },
        { id: "bathrooms", value: property.bathrooms || "" },
        { id: "price", value: String(property.price || "") },
        { id: "mls_status", value: normalizeMLSStatus(property.mlsStatus) },
        { id: "tax_value", value: property.taxValue ?? undefined },
        {
          id: "first_lien_amount",
          value: property.firstLienAmount ?? undefined,
        },
        {
          id: "owner_occupied",
          value: normalizeYesNo(property.ownerOccupied) || "",
        },
        {
          id: "contact_2_phone_1",
          value: property.contact2Phone1 ?? undefined,
        },
        {
          id: "contact_2_phone_1_dnc",
          value: property.contact2Phone1Dnc ?? undefined,
        },
        { id: "heating_type", value: property.heatingType ?? undefined },
        {
          id: "contact_2_phone_1_line_type",
          value: property.contact2Phone1LineType ?? undefined,
        },
        { id: "seller_timing", value: property.sellerTiming ?? undefined },
        { id: "cooling_type", value: property.coolingType ?? undefined },
        {
          id: "contact_2_phone_2",
          value: property.contact2Phone2 ?? undefined,
        },
        {
          id: "contact_2_phone_2_dnc",
          value: property.contact2Phone2Dnc ?? undefined,
        },
        { id: "home_condition", value: property.homeCondition || "" },
        {
          id: "contact_2_phone_2_line_type",
          value: property.contact2Phone2LineType ?? undefined,
        },
        { id: "basement_sqft", value: property.basementSqft ?? undefined },
        { id: "basement_type", value: property.basementType ?? undefined },
        {
          id: "contact_2_email_1",
          value: property.contact2Email1 ?? undefined,
        },
        {
          id: "contact_2_email_2",
          value: property.contact2Email2 ?? undefined,
        },
        {
          id: "parkting_type",
          value: parkingMapping[property.parkingType ?? ""] ?? "Other",
        },
        { id: "parking_spaces", value: property.parkingSpaces ?? undefined },
        { id: "owner_status", value: property.ownerStatus ?? undefined },
        { id: "rental_history", value: property.rentalHistory ?? undefined },
        {
          id: "in_preforclosure",
          value: normalizeYesNo(property.inPreforclosure) || "",
        },
        {
          id: "resale_value_arv",
          value: property.resaleValueArv ?? undefined,
        },
        { id: "lender_name", value: property.lenderName ?? undefined },
        {
          id: "contact_1_phone_1_dnc",
          value: property.contact1Phone1Dnc ?? undefined,
        },
        { id: "realtors_name", value: property.realtorSName ?? undefined },
        {
          id: "date_of_auction",
          value: property.dateOfAuction
            ? new Date(property.dateOfAuction).toISOString()
            : undefined,
        },
        { id: "plaintiff_name", value: property.plaintiffName ?? undefined },
        {
          id: "contact_1_phone_1_line_type",
          value: property.contact1Phone1LineType ?? undefined,
        },
        { id: "attorney", value: property.attorney ?? undefined },
        { id: "est_opening_bid", value: property.estOpeningBid ?? undefined },
        {
          id: "contact_1_phone_2",
          value: property.contact1Phone2 ?? undefined,
        },
        {
          id: "attorney_phone_number",
          value: property.attorneyPhoneNumber ?? undefined,
        },
        { id: "contact_2", value: property.contact2 ?? undefined },
        { id: "mls_number", value: property.mlsNumber || "" },
        {
          id: "square_footage",
          value: property.aboveGradeFinishedSqft || "",
        },
        {
          id: "loan_type",
          value: normalizedLoanType(property.loanType) || "",
        },
        {
          id: "loan_maturity_date",
          value: property.loanMaturityDate ?? undefined,
        },
        {
          id: "working_with_realtor",
          value: normalizeWorkingWithRealtor(property.workingWithRealtor),
        },
        {
          id: "contact_1_phone_2_dnc",
          value: property.contact1Phone2Dnc ?? undefined,
        },
        {
          id: "seller_motivation",
          value: property.sellerMotivation ?? undefined,
        },
        {
          id: "contact_1_phone_2_line_type",
          value: property.contact1Phone2LineType ?? undefined,
        },
        {
          id: "contact_1_email_2",
          value: property.contact1Email2 ?? undefined,
        },
        { id: "owner_type", value: property.ownerType ?? undefined },
        {
          id: "free_and_clear",
          value: normalizeFreeAndClear(property.freeAndClear) || "",
        },
        {
          id: "estimated_mtg_payment",
          value:
            property.estimatedMtgPayment != null
              ? Number(property.estimatedMtgPayment)
              : undefined,
        },
        {
          id: "avm",
          value:
            property.automatedValue != null
              ? Number(property.automatedValue)
              : undefined,
        },
        {
          id: "avm_min",
          value:
            property.automatedValueMinimum != null
              ? Number(property.automatedValueMinimum)
              : undefined,
        },
        {
          id: "avm_max",
          value:
            property.automatedValueMaximum != null
              ? Number(property.automatedValueMaximum)
              : undefined,
        },
        { id: "owner_address", value: property.ownerAddress ?? undefined },
        {
          id: "equity_",
          value: property.equity != null ? Number(property.equity) : undefined,
        },
        {
          id: "household_income",
          value:
            normalizeHouseholdIncome(property.householdIncome) ?? undefined,
        },
        { id: "owner_city", value: property.ownerCity ?? undefined },
        {
          id: "asking_price",
          value:
            property.askingPrice != null
              ? Number(property.askingPrice)
              : undefined,
        },
        {
          id: "liquid_assets",
          value: normalizeLiquidAssets(property.liquidAssets),
        },
        {
          id: "year_built",
          value: property.yearBuilt?.toString() ?? undefined,
        },
        {
          id: "property_type",
          value: normalizePropertyType(property.propertyType) || "",
        },
        { id: "pool", value: normalizedPool },
        { id: "county", value: property.county ?? undefined },
        { id: "owner_zip", value: property.ownerZip ?? undefined },
        { id: "owner_state", value: property.ownerState ?? undefined },
        { id: "landline_1", value: property.landline1 ?? undefined },
        { id: "landline_2", value: property.landline2 ?? undefined },
        { id: "landline_3", value: property.landline3 ?? undefined },
        { id: "landline_4", value: property.landline4 ?? undefined },
        { id: "landline_5", value: property.landline5 ?? undefined },
        {
          id: "contact_1_phone_3",
          value: property.contact1Phone3 ?? undefined,
        },
        {
          id: "estimated_equity",
          value:
            property.estimatedEquity != null
              ? Number(property.estimatedEquity)
              : undefined,
        },
        {
          id: "lead_source",
          value: normalizeLeadSource(property.leadSource) ?? undefined,
        },
        { id: "lot_size", value: property.lotSize ?? undefined },
        {
          id: "estimated_mtg_balance",
          value: property.estimatedMtgBalance || "",
        },
        { id: "sq_feet", value: property.aboveGradeFinishedSqft || "" },
      ],
    };

    for (const k of Object.keys(contactPayload)) {
      if (contactPayload[k] === undefined || contactPayload[k] === null)
        delete contactPayload[k];
    }

    try {
      // RATE-LIMITED REQUEST
      const resp = await rateLimitedRequest(() =>
        axios.post(`${GHL_BASE_URL}/contacts/`, contactPayload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            Version: API_VERSION,
          },
        })
      );

      if (resp.status === 201 || resp.status === 200) {
        const ghlContactId = resp.data.contact?.id || resp.data.id;

        await prisma.contact.update({
          where: { id: contact.id },
          data: { pushed: true, ghlContactId },
        });

        logger.info(
          `✔ Pushed contact ID ${contact.id} (GHL: ${ghlContactId})`
        );
        contactIdMap[contact.id] = ghlContactId;

        pushedContactCount++;
        await updateJobProgress(job.id, {
          processed: pushedContactCount,
          total: contactsToPush.size + properties.length,
          status: `Pushed ${pushedContactCount}/${contactsToPush.size} contacts`,
        }).catch((err) => console.warn("Progress update failed:", err));
      } else {
        console.error(
          `✖ GHL responded ${resp.status} ${resp.statusText} for contact ${contact.id}`
        );
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (err.response) {
          console.error(`❌ GHL Error for contact ID ${contact.id}:`, {
            status: err.response.status,
            data: err.response.data,
            headers: err.response.headers,
          });
        } else {
          console.error(
            `❌ Network error for contact ID ${contact.id}:`,
            err.message
          );
        }
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(
          `❌ Error pushing contact ID ${contact.id}:`,
          errorMessage
        );
      }
    }
  }

  logger.info(
    `\n👥 Contact push complete: ${pushedContactCount}/${contactsToPush.size}\n`
  );

  // ========================================================================
  // STEP 5: Push properties and create associations
  // ========================================================================
  for (const p of properties) {
    // ✅ NEW: Check local database first
    const localProperty = await findLocalProperty(p.addressFull);

    if (localProperty?.ghlPropertyId) {
      logger.info(
        `✅ Found existing property in local DB: ${localProperty.ghlPropertyId}`
      );

      // Mark as pushed if not already
      if (!p.pushed) {
        await prisma.property.update({
          where: { id: p.id },
          data: {
            pushed: true,
            pushedAt: new Date(),
            ghlPropertyId: localProperty.ghlPropertyId,
          },
        });
      }

      // Still need to create association
      let ghlContactId: string | undefined = contactIdMap[p.ownerId!];

      if (!ghlContactId && p.ownerId) {
        const owner = await prisma.contact.findUnique({
          where: { id: p.ownerId },
          select: { email: true, phone: true, ghlContactId: true },
        });

        if (owner?.ghlContactId) {
          ghlContactId = owner.ghlContactId;
        } else if (owner) {
          ghlContactId = await rateLimitedRequest(() =>
            findGhlContactByEmailOrPhone(
              owner.email,
              owner.phone,
              accessToken,
              locationId
            )
          );
        }
      }

      if (ghlContactId && localProperty.ghlPropertyId) {
        logger.info(
          `🔗 Associating existing property ${p.id} with contact ${p.ownerId}`
        );
        await rateLimitedRequest(() =>
          ensureContactPropertyAssociation(
            ghlContactId,
            localProperty.ghlPropertyId!,
            accessToken,
            locationId
          )
        );
        associationCount++;
      }

      continue; // Skip GHL property creation
    }

    const existingGhlId = await rateLimitedRequest(() =>
      findGhlPropertyByAddress(p.addressFull, accessToken, locationId)
    );

    if (existingGhlId) {
      logger.info(`Found existing property in GHL: ${existingGhlId}`);

      // Mark as pushed with timestamp if not already marked
      if (!p.pushed) {
        await prisma.property.update({
          where: { id: p.id },
          data: {
            pushed: true,
            pushedAt: new Date(),
            ghlPropertyId: existingGhlId,
          },
        });
      }

      let ghlContactId: string | undefined = contactIdMap[p.ownerId!];

      if (!ghlContactId && p.ownerId) {
        const owner = await prisma.contact.findUnique({
          where: { id: p.ownerId },
          select: { email: true, phone: true, ghlContactId: true },
        });

        if (owner) {
          ghlContactId = await rateLimitedRequest(() =>
            findGhlContactByEmailOrPhone(
              owner.email,
              owner.phone,
              accessToken,
              locationId
            )
          );
        }
      }

      if (ghlContactId && existingGhlId) {
        logger.info(
          `🔗 Associating existing property ${p.id} (GHL: ${existingGhlId}) with contact ${p.ownerId} (GHL: ${ghlContactId})`
        );
        await rateLimitedRequest(() =>
          ensureContactPropertyAssociation(
            ghlContactId,
            existingGhlId,
            accessToken,
            locationId
          )
        );
        associationCount++;
      }
      continue; // Skip creation
    }

    if (!p.ownerId) {
      console.warn(`⚠️ Property ID ${p.id} has no ownerId, skipping`);
      continue;
    }

    // Try to get GHL contact ID from our map first
    let ghlContactId: string | undefined = contactIdMap[p.ownerId];

    // If not in map, try to find it again (fallback)
    if (!ghlContactId) {
      const owner = await prisma.contact.findUnique({
        where: { id: p.ownerId },
        select: { email: true, phone: true, ghlContactId: true },
      });

      if (owner) {
        ghlContactId = await rateLimitedRequest(() =>
          findGhlContactByEmailOrPhone(
            owner.email,
            owner.phone,
            accessToken,
            locationId
          )
        );
      }
    }

    if (!ghlContactId) {
      console.warn(
        `⚠️ Property ID ${p.id} owner (${p.ownerId}) wasn't pushed successfully, skipping property`
      );
      continue;
    }

    const customFields: Record<string, unknown> = {};
    const loanTypeKey = normalizeLoanType(p.loanType);

    const fieldMappings = {
      city: p.city,
      state: p.state,
      zippostal: p.postalCode,
      beds: p.bedrooms,
      baths: p.bathrooms,
      sq_feet: p.aboveGradeFinishedSqft,
      free_and_clear: p.freeAndClear,
      equity_: toNumber(p.equity),
      year_built: toNumber(p.yearBuilt),
      property_type: normalizePropertyType(p.propertyType),
      seller_motivation: p.sellerMotivation,
      in_preforclosure: normalizeYesNo(p.inPreforclosure),
      home_condition: p.homeCondition,
      owner_occupied: normalizeYesNo(p.ownerOccupied),
      loan_type: loanTypeKey ?? "",
    };

    if (p.estimatedEquity) {
      const val = toFloat(p.estimatedEquity);
      if (val !== null) {
        customFields["estimated_equity"] = {
          currency: "default",
          value: val,
        };
      }
    }

    if (p.estimatedMtgBalance) {
      const val = toNumber(p.estimatedMtgBalance);
      if (val !== null) {
        customFields["estimated_mtg_balance"] = {
          currency: "default",
          value: val,
        };
      }
    }

    if (p.resaleValueArv) {
      const val = toNumber(p.resaleValueArv);
      if (val !== null) {
        customFields["resale_value_arv"] = {
          currency: "default",
          value: val,
        };
      }
    }

    if (p.askingPrice) {
      const val = toNumber(p.askingPrice);
      if (val !== null) {
        customFields["asking_price"] = { currency: "default", value: val };
      }
    }

    for (const [key, val] of Object.entries(fieldMappings)) {
      if (val !== null && val !== undefined && val !== "") {
        customFields[key] = val;
      }
    }

    const payload = {
      properties: {
        address: p.addressFull,
        ...customFields,
      },
      locationId: locationId,
    };

    console.debug(
      `📦 Prepared payload for property ID ${p.id}:`,
      JSON.stringify(payload, null, 2)
    );

    try {
      // RATE-LIMITED REQUEST
      const resp = await rateLimitedRequest(() =>
        axios.post(
          `${GHL_BASE_URL}/objects/${CUSTOM_OBJECT_KEY}/records`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
              "Content-Type": "application/json",
              Version: API_VERSION,
            },
          }
        )
      );

      if (resp.status === 201 || resp.status === 200) {
        const ghlPropertyId = extractGhlId(resp.data);

        if (ghlPropertyId) {
          await prisma.property.update({
            where: { id: p.id },
            data: {
              pushed: true,
              pushedAt: new Date(), // ✅ Track when pushed
              ghlPropertyId,
            },
          });
        }

        if (!ghlPropertyId) {
          console.warn(
            `⚠️ Created property ${p.id} but could not find GHL id in response.`
          );
          console.debug("Full resp.data:", JSON.stringify(resp.data, null, 2));
        }

        pushedPropertyCount++;
        logger.info(`✔ Pushed property ID ${p.id} (GHL: ${ghlPropertyId})`);

        await updateJobProgress(job.id, {
          processed: contactsToPush.size + pushedPropertyCount,
          total: contactsToPush.size + properties.length,
          status: `Pushed ${pushedPropertyCount}/${properties.length} properties`,
        }).catch((err) => console.warn("Progress update failed:", err));

        // Create association
        if (ghlPropertyId && ghlContactId) {
          logger.info(
            `🔗 Associating property ${p.id} (GHL: ${ghlPropertyId}) with contact ${p.ownerId} (GHL: ${ghlContactId})`
          );
          await rateLimitedRequest(() =>
            ensureContactPropertyAssociation(
              ghlContactId,
              ghlPropertyId,
              accessToken,
              locationId
            )
          );
          associationCount++;
        } else {
          console.warn(
            `⚠️ Skipping association for property ${p.id}: missing GHL IDs`
          );
        }
      } else {
        console.error(
          `✖ GHL responded ${resp.status} ${resp.statusText} for property ${p.id}`
        );
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (err.response) {
          console.error(`❌ GHL Error for property ID ${p.id}:`, {
            status: err.response.status,
            data: err.response.data,
            headers: err.response.headers,
          });
        } else {
          console.error(
            `❌ Network error for property ID ${p.id}:`,
            err.message
          );
        }
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`❌ Error pushing property ID ${p.id}:`, errorMessage);
      }
    }
  }

  logger.info(`
========================================
✅ Job ${job.id} COMPLETE
========================================
📊 Properties pushed: ${pushedPropertyCount}/${properties.length}
👥 Contacts pushed: ${pushedContactCount}/${contactsToPush.size}
🔗 Associations created: ${associationCount}
🔑 OAuth token used for: ${user.email || user.id}
📍 Location ID: ${locationId}
🎯 Mode: ${isPreIdentified
      ? "Daily Queue (Pre-identified)"
      : "Webhook (Query with limit)"
    }
========================================
  `);
}