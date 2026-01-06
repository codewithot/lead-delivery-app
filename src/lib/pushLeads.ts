import {
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
import { logGHLError } from '@/lib/fileLogger';
import { prisma } from "@/lib/prisma";

const logger = createLogger('PushLeads');
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
export async function pushLeadsForUser(job: Job, correlationId?: string) {
  // Create scoped logger with correlation ID for distributed tracing
  const scopedLogger = correlationId
    ? createLogger('PushLeads').withCorrelationId(correlationId)
    : logger;

  scopedLogger.info('Starting job', { jobId: job.id, userId: job.userId });
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

  const accessToken = await getValidAccessToken(user, correlationId);
  const locationId = user.locationId;
  const settings = user.settings as UserSettings;

  scopedLogger.info('Using OAuth token', { userId: user.email || user.id });
  scopedLogger.info('Location ID configured', { locationId });

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
    scopedLogger.info('Daily queue mode', { propertyCount: payload.properties.length });
    preIdentifiedProps = payload.properties;
    totalToProcess = preIdentifiedProps.length;
    isPreIdentified = true;
  } else {
    scopedLogger.info('Webhook mode: calculating limits and count');
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
      scopedLogger.info('Plan limit reached for today, skipping');
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
    scopedLogger.info('Plan limits calculated', {
      planLimit: settings.planLimit,
      remainingLimit,
      foundCount,
      toProcess: totalToProcess
    });
  }

  if (totalToProcess === 0) {
    scopedLogger.info('No properties to process');
    return;
  }

  const contactIdMap: Record<number, string> = {};
  let pushedContactCount = 0;
  let pushedPropertyCount = 0;
  let associationCount = 0;

  // ========================================================================
  // STEP 3: Identify unique contacts and process them
  // ========================================================================
  let propertyIdsToProcess: number[] = [];
  const contactsToPush = new Map<number, Contact>();
  const contactToPropertyIdMap = new Map<number, number>();

  if (isPreIdentified) {
    propertyIdsToProcess = preIdentifiedProps.map(p => p.id);
    for (const p of preIdentifiedProps) {
      if (p.owner && !p.owner.pushed && p.ownerId) {
        contactsToPush.set(p.ownerId, p.owner);
        if (!contactToPropertyIdMap.has(p.ownerId)) {
          contactToPropertyIdMap.set(p.ownerId, p.id);
        }
      }
    }
  } else {
    // 🟠 OPTIMIZATION: Fetch ONLY IDs first to keep memory low
    // Use batching if provided in payload to prevent duplicates across concurrent jobs
    const batchSize = payload.batchSize || 100; // Default or from payload
    const batchIndex = payload.batchIndex || 0;
    const skip = batchIndex * batchSize;

    // effectiveTake is min(totalToProcess, batchSize) because totalToProcess is the limit for this run
    // actually totalToProcess calculation earlier already capped it by limit.
    // simpler: just take batchSize, but we must respect the overall plan limit which totalToProcess represents?
    // Wait, totalToProcess is calculated based on `pushed: false` count.

    // If we use skip, we are assuming the order is stable (createdAt).
    const propRows = await prisma.property.findMany({
      where: {
        price: {
          gte: settings.priceMin ?? 0,
          lte: settings.priceMax ?? Number.MAX_SAFE_INTEGER,
        },
        postalCode: { in: settings.zipCodes },
        pushed: false,
      },
      select: { id: true, ownerId: true },
      take: batchSize, // Take only this batch's share
      skip: skip,      // Skip previous batches
      orderBy: { createdAt: "asc" },
    });

    propertyIdsToProcess = propRows.map(p => p.id);

    // Identify unique owner IDs that aren't pushed and map them to a property
    for (const row of propRows) {
      if (row.ownerId && !contactToPropertyIdMap.has(row.ownerId)) {
        contactToPropertyIdMap.set(row.ownerId, row.id);
      }
    }

    const uniqueOwnerIds = Array.from(contactToPropertyIdMap.keys());

    if (uniqueOwnerIds.length > 0) {
      const owners = await prisma.contact.findMany({
        where: {
          id: { in: uniqueOwnerIds },
          pushed: false
        }
      });
      for (const owner of owners) {
        contactsToPush.set(owner.id, owner);
      }
    }
  }

  // Fetch only one property per contact for contact creation metadata
  const contactPropertiesMap = new Map<number, Property>();
  const propertyIdsForContacts = Array.from(contactToPropertyIdMap.values());

  if (propertyIdsForContacts.length > 0) {
    const contactProps = await prisma.property.findMany({
      where: { id: { in: propertyIdsForContacts } }
    });
    for (const prop of contactProps) {
      // Find which contact this property belongs to
      for (const [contactId, propId] of contactToPropertyIdMap.entries()) {
        if (propId === prop.id) {
          contactPropertiesMap.set(contactId, prop);
        }
      }
    }
  }

  scopedLogger.info('Identified leads to push', {
    propertyCount: propertyIdsToProcess.length,
    contactCount: contactsToPush.size
  });

  // Initialize progress tracking
  await updateJobProgress(job.id, {
    processed: 0,
    total: propertyIdsToProcess.length + contactsToPush.size,
    status: `Starting push for ${propertyIdsToProcess.length} properties`,
  }).catch((err) => scopedLogger.warn("Progress update failed", { error: err }));

  scopedLogger.info('Found unique contacts to push', { contactCount: contactsToPush.size });

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
      scopedLogger.info('Found existing contact in local DB', {
        ghlContactId: localContact.ghlContactId,
        localContactId: contactId
      });
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
      scopedLogger.info('Found existing contact in GHL', {
        ghlContactId: existingGhlId,
        localContactId: contactId
      });
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

    // ✅ Optimized: Use pre-fetched property data
    const property = contactPropertiesMap.get(contactId);

    if (!property) {
      scopedLogger.warn(
        `⚠️ Contact ID ${contactId} has no associated property data, skipping`
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
      locationId, // ✅ Required by GHL API
      firstName: contact.firstName ?? undefined,
      lastName: contact.lastName ?? undefined,
      email: contact.email && contact.email.trim() ? contact.email : undefined,
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
            timeout: process.env.TIMEOUT,
          },
        })
      );

      if (resp.status === 201 || resp.status === 200) {
        const ghlContactId = resp.data.contact?.id || resp.data.id;

        await prisma.contact.update({
          where: { id: contact.id },
          data: { pushed: true, ghlContactId },
        });

        scopedLogger.info('Pushed contact successfully', {
          localContactId: contact.id,
          ghlContactId
        });
        contactIdMap[contact.id] = ghlContactId;

        pushedContactCount++;
        await updateJobProgress(job.id, {
          processed: pushedContactCount,
          total: contactsToPush.size + propertyIdsToProcess.length,
          status: `Pushed ${pushedContactCount}/${contactsToPush.size} contacts`,
        }).catch((err) => console.warn("Progress update failed:", err));
      } else {
        scopedLogger.error(
          `✖ GHL responded ${resp.status} ${resp.statusText} for contact ${contact.id}`
        );
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (err.response) {
          const ghlErrorMsg = err.response.data?.message || err.response.data?.error || JSON.stringify(err.response.data);

          // Handle duplicate contact - extract existing contact ID
          if (err.response.status === 400 && err.response.data?.meta?.contactId) {
            const existingContactId = err.response.data.meta.contactId;
            scopedLogger.info('Contact already exists, using existing ID', {
              localContactId: contact.id,
              ghlContactId: existingContactId,
              matchingField: err.response.data.meta.matchingField
            });

            contactIdMap[contact.id] = existingContactId;

            // Update local DB with the existing GHL ID
            await prisma.contact.update({
              where: { id: contact.id },
              data: {
                ghlContactId: existingContactId,
                pushed: true
              },
            });

            pushedContactCount++;
            continue; // Skip to next contact
          }

          // For other errors, log and continue
          console.error(`❌ GHL API Error for contact ID ${contact.id}:`, {
            status: err.response.status,
            statusText: err.response.statusText,
            errorMessage: ghlErrorMsg,
            data: err.response.data,
          });

          // Log to file for later inspection
          logGHLError(`Contact ${contact.id}`, {
            status: err.response.status,
            statusText: err.response.statusText,
            errorMessage: ghlErrorMsg,
            data: err.response.data,
          });

          // Don't throw - continue with other contacts
          continue;
        } else {
          console.error(
            `❌ Network error for contact ID ${contact.id}:`,
            err.message
          );
          continue;
        }
      } else {
        const errorDetails = err instanceof Error ? err.message : String(err);
        scopedLogger.error(
          `❌ Error pushing contact ID ${contact.id}`,
          { error: errorDetails }
        );
        continue;
      }
    }
  }

  scopedLogger.info('Contact push complete', {
    pushed: pushedContactCount,
    total: contactsToPush.size
  });

  // ========================================================================
  // STEP 5: Push properties and create associations in batches
  // ========================================================================
  const PUSH_BATCH_SIZE = 50;

  for (let i = 0; i < propertyIdsToProcess.length; i += PUSH_BATCH_SIZE) {
    const batchIds = propertyIdsToProcess.slice(i, i + PUSH_BATCH_SIZE);

    // 🟠 FETCH BATCH: Load only what we need for this chunk
    let batch: (Property & { owner?: Contact | null })[] = [];

    if (isPreIdentified) {
      batch = preIdentifiedProps.slice(i, i + PUSH_BATCH_SIZE);
    } else {
      batch = await prisma.property.findMany({
        where: { id: { in: batchIds } },
        include: { owner: true }
      });
    }

    scopedLogger.info('Processing property batch', {
      batchNumber: Math.floor(i / PUSH_BATCH_SIZE) + 1,
      propertyCount: batch.length
    });

    for (const p of batch) {
      try {
        // ✅ NEW: Check local database first
        const localProperty = await findLocalProperty(p.addressFull);

        if (localProperty?.ghlPropertyId) {
          scopedLogger.info('Found existing property in local DB', {
            ghlPropertyId: localProperty.ghlPropertyId
          });

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
            scopedLogger.info('Associating existing property with contact', {
              localPropertyId: p.id,
              ownerId: p.ownerId
            });
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
          scopedLogger.info('Found existing property in GHL', { ghlPropertyId: existingGhlId });

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
            scopedLogger.info('Associating existing property with contact', {
              localPropertyId: p.id,
              ghlPropertyId: existingGhlId,
              ownerId: p.ownerId,
              ghlContactId
            });
            await rateLimitedRequest(() =>
              ensureContactPropertyAssociation(
                ghlContactId,
                existingGhlId,
                accessToken,
                locationId,
                correlationId
              )
            );
            associationCount++;
          }
          continue; // Skip creation
        }

        if (!p.ownerId) {
          scopedLogger.warn(`⚠️ Property ID ${p.id} has no ownerId, skipping`);
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
                timeout: process.env.TIMEOUT,
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
            scopedLogger.warn(
              `⚠️ Created property ${p.id} but could not find GHL id in response.`
            );
            scopedLogger.debug("Full resp.data", { data: resp.data });
          }

          pushedPropertyCount++;
          scopedLogger.info('Pushed property successfully', {
            localPropertyId: p.id,
            ghlPropertyId
          });

          await updateJobProgress(job.id, {
            processed: contactsToPush.size + pushedPropertyCount,
            total: contactsToPush.size + propertyIdsToProcess.length,
            status: `Pushed ${pushedPropertyCount}/${propertyIdsToProcess.length} properties`,
          }).catch((err) => console.warn("Progress update failed:", err));

          // Create association
          if (ghlPropertyId && ghlContactId) {
            scopedLogger.info('Associating new property with contact', {
              localPropertyId: p.id,
              ghlPropertyId,
              ownerId: p.ownerId,
              ghlContactId
            });
            await rateLimitedRequest(() =>
              ensureContactPropertyAssociation(
                ghlContactId,
                ghlPropertyId,
                accessToken,
                locationId,
                correlationId
              )
            )
            associationCount++;
          } else {
            scopedLogger.warn(
              `⚠️ Skipping association for property ${p.id}: missing GHL IDs`
            );
          }
        } else {
          scopedLogger.error(
            `✖ GHL responded ${resp.status} ${resp.statusText} for property ${p.id}`
          );
        }
      } catch (err: unknown) {
        let errorDetails = '';
        if (axios.isAxiosError(err)) {
          if (err.response) {
            // Extract detailed error message from GHL response
            const ghlErrorMsg = err.response.data?.message || err.response.data?.error || JSON.stringify(err.response.data);
            errorDetails = `GHL ${err.response.status}: ${ghlErrorMsg}`;

            console.error(`❌ GHL API Error for property ID ${p.id}:`, {
              status: err.response.status,
              statusText: err.response.statusText,
              address: p.addressFull,
              errorMessage: ghlErrorMsg,
              data: err.response.data,
            });
          } else {
            errorDetails = `Network error: ${err.message}`;
            console.error(
              `❌ Network error for property ID ${p.id}:`,
              err.message
            );
          }
        } else {
          errorDetails = err instanceof Error ? err.message : String(err);
          scopedLogger.error(`❌ Error pushing property ID ${p.id}`, { error: errorDetails });
        }
        // Re-throw with detailed error for worker manager logging
        throw new Error(`Failed to push property ${p.id} (${p.addressFull}): ${errorDetails}`);
      }
    }

    // Explicitly yield to give GC a chance if needed
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  scopedLogger.info('Job complete', { jobId: job.id, propertiesPushed: pushedPropertyCount, totalProperties: propertyIdsToProcess.length, contactsPushed: pushedContactCount, totalContacts: contactsToPush.size, associationsCreated: associationCount, userId: user.email || user.id, locationId, mode: isPreIdentified ? 'Daily Queue (Pre-identified)' : 'Webhook (Query with limit)' });
}
