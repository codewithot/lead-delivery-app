import { PrismaClient, type Job, type UserSettings } from "@prisma/client";
import axios from "axios";
import { normalizeCountry, normalizePostalCode } from "./normalizeCountry.ts";
import { rateLimitedRequest } from "./rateLimiter";
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
} from "./helper.ts";
import { updateJobProgress } from "./jobProgress";

const prisma = new PrismaClient();
const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const CUSTOM_OBJECT_KEY = "custom_objects.properties";
const API_VERSION = "2021-07-28";

// Multi-account configuration
const GHL_ACCOUNTS = [
  // {
  //   name: "ProEdge Sandbox",
  //   locationId: process.env.GHL_LOCATION_ID || "FmyBGGVhzMmKaYko3PsW",
  //   privateToken:
  //     process.env.GHL_PRIVATE_TOKEN ||
  //     "pit-04ee49b1-2e1c-4276-ba9c-7e20b3cacb3c",
  // },
  {
    name: "Direct One Home Buyers",
    locationId:
      process.env.GHL_LOCATION_IDdirectOneHomeBuyers || "3eqjaHp2WwPxvUWCV9Mb",
    privateToken:
      process.env.GHL_PRIVATE_TOKENdirectOneHomeBuyers ||
      "pit-f6adc9b4-0de0-4911-a09b-ff57cb9b3a41",
  },
  // {
  //   name: "SmartytheRealtor",
  //   locationId:
  //     process.env.GHL_LOCATION_IDsmartytheRealtor || "P4Rt72mIVJCPh4w5FHRt",
  //   privateToken:
  //     process.env.GHL_PRIVATE_TOKENsmartytheRealtor ||
  //     "pit-b1652b14-6a49-4c64-91d6-74dffe481cbc",
  // },
];

export async function pushLeadsForUser(job: Job) {
  console.info(`▶ Starting job id=${job.id}, userId=${job.userId}`);
  console.debug(`Payload: ${JSON.stringify(job.payload)}`);

  const user = await prisma.user.findUnique({
    where: { id: job.userId },
    include: { settings: true },
  });

  if (!user || !user.settings) {
    throw new Error("Missing OAuth credentials or user settings");
  }

  const settings = user.settings as UserSettings;

  // ========================================================================
  // STEP 1: Fetch all properties that need to be pushed
  // Properties drive the process - only their owners will be pushed
  // ========================================================================
  const properties = await prisma.property.findMany({
    where: {
      price: {
        gte: settings.priceMin ?? 0,
        lte: settings.priceMax ?? Number.MAX_SAFE_INTEGER,
      },
      postalCode: { in: settings.zipCodes },
      pushed: false,
    },
    include: {
      owner: true,
    },
  });

  if (!properties.length) {
    console.info("✔ Nothing to push");
    return;
  }

  console.info(
    `🔍 Found ${properties.length} matching properties for job ${job.id}`
  );

  // Initialize progress tracking
  await updateJobProgress(job.id, {
    processed: 0,
    total: properties.length,
    status: `Found ${properties.length} properties to push`,
  }).catch((err) => console.warn("Progress update failed:", err));

  // ========================================================================
  // STEP 2: Identify unique contacts that need to be pushed
  // Only push contacts that own at least one property being pushed
  // ========================================================================
  const contactsToPush = new Map<number, (typeof properties)[0]["owner"]>();

  for (const property of properties) {
    if (property.owner && !property.owner.pushed && property.ownerId) {
      contactsToPush.set(property.ownerId, property.owner);
    }
  }

  console.info(`👥 Found ${contactsToPush.size} unique contacts to push`);

  // Track results across all accounts
  const accountResults = {
    contacts: {} as Record<string, number>,
    properties: {} as Record<string, number>,
    associations: {} as Record<string, number>,
  };

  for (const account of GHL_ACCOUNTS) {
    console.info(`\n========================================`);
    console.info(`🏢 Pushing to: ${account.name}`);
    console.info(`========================================\n`);

    const contactIdMap: Record<number, string> = {};
    let pushedContactCount = 0;

    // ========================================================================
    // STEP 3: Push contacts first
    // We need their GHL IDs to create associations later
    // ========================================================================
    for (const [contactId, contact] of contactsToPush) {
      if (!contact.email && !contact.phone) {
        console.warn(
          `⚠️ Skipping contact ID ${contactId} - no email or phone number`
        );
        continue;
      }

      // First try to find existing contact (rate-limited)
      const existingGhlId = await rateLimitedRequest(() =>
        findGhlContactByEmailOrPhone(
          contact.email,
          contact.phone,
          account.privateToken,
          account.locationId
        )
      );

      if (existingGhlId) {
        console.info(
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

      const property = properties.find((p) => p.ownerId === contactId);

      if (!property) {
        console.warn(
          `⚠️ Contact ID ${contactId} has no property in current batch, skipping`
        );
        continue;
      }

      let normalizedInPreforclosure: "True" | "False" | null = null;
      if (property.inPreforclosure) {
        const val = property.inPreforclosure.toLowerCase();
        if (val === "yes") normalizedInPreforclosure = "True";
        else if (val === "no") normalizedInPreforclosure = "False";
      }

      let normalizedPool: "True" | "False" | null = null;
      if (property.pool) {
        const val = property.pool.toLowerCase();
        if (val === "yes" || val === "true") normalizedPool = "True";
        else if (val === "no" || val === "false") normalizedPool = "False";
      }

      const tagsArray = buildTags(property.tags, (contact as any)?.tags);

      const contactPayload: Record<string, any> = {
        locationId: account.locationId,
        firstName: contact.firstName ?? undefined,
        lastName: contact.lastName ?? undefined,
        email: contact.email ?? undefined,
        phone: contact.phone ?? undefined,
        address1: property.streetAddress ?? undefined,
        tags: tagsArray ?? undefined,
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
            value:
              property.equity != null ? Number(property.equity) : undefined,
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
              Authorization: `Bearer ${account.privateToken}`,
              Accept: "application/json",
              "Content-Type": "application/json",
              Version: API_VERSION,
            },
          })
        );

        if (resp.status === 201 || resp.status === 200) {
          const ghlContactId = resp.data.contact?.id || resp.data.id;

          // Only update the database once (after first successful push)
          if (account === GHL_ACCOUNTS[0]) {
            await prisma.contact.update({
              where: { id: contact.id },
              data: { pushed: true, ghlContactId },
            });
          }

          console.info(
            `✓ [${account.name}] Pushed contact ID ${contact.id} (GHL: ${ghlContactId})`
          );
          contactIdMap[contact.id] = ghlContactId;

          // ADD THIS: Track progress
          pushedContactCount++;
          await updateJobProgress(job.id, {
            processed: pushedContactCount,
            total: contactsToPush.size + properties.length,
            status: `Pushed ${pushedContactCount}/${contactsToPush.size} contacts`,
          }).catch((err) => console.warn("Progress update failed:", err));
        } else {
          console.error(
            `✖ [${account.name}] GHL responded ${resp.status} ${resp.statusText} for contact ${contact.id}`
          );
        }
      } catch (err: any) {
        if (err.response) {
          console.error(
            `❌ [${account.name}] GHL Error for contact ID ${contact.id}:`,
            {
              status: err.response.status,
              data: err.response.data,
              headers: err.response.headers,
            }
          );
        } else {
          console.error(
            `❌ [${account.name}] Error pushing contact ID ${contact.id}:`,
            err
          );
        }
      }
    }

    accountResults.contacts[account.name] = Object.keys(contactIdMap).length;
    console.info(
      `✓ [${account.name}] Successfully pushed ${
        Object.keys(contactIdMap).length
      } contacts`
    );

    // ========================================================================
    // STEP 4: Push properties and create associations
    // Only push properties whose owners were successfully pushed
    // ========================================================================
    let pushedPropertyCount = 0;
    let associationCount = 0;

    for (const p of properties) {
      // RATE-LIMITED REQUEST
      const existingGhlId = await rateLimitedRequest(() =>
        findGhlPropertyByAddress(
          p.addressFull,
          account.privateToken,
          account.locationId
        )
      );

      if (existingGhlId) {
        console.info(`Found existing property in GHL: ${existingGhlId}`);

        let ghlContactId: string | undefined = contactIdMap[p.ownerId!];

        if (!ghlContactId && p.ownerId) {
          const owner = await prisma.contact.findUnique({
            where: { id: p.ownerId },
            select: { email: true, phone: true, ghlContactId: true },
          });

          if (owner) {
            // RATE-LIMITED REQUEST
            ghlContactId = await rateLimitedRequest(() =>
              findGhlContactByEmailOrPhone(
                owner.email,
                owner.phone,
                account.privateToken,
                account.locationId
              )
            );
          }
        }

        if (ghlContactId && existingGhlId) {
          console.info(
            `🔗 [${account.name}] Associating existing property ${p.id} (GHL: ${existingGhlId}) with contact ${p.ownerId} (GHL: ${ghlContactId})`
          );
          // RATE-LIMITED REQUEST
          await rateLimitedRequest(() =>
            ensureContactPropertyAssociation(
              ghlContactId,
              existingGhlId,
              account.privateToken,
              account.locationId
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
          // RATE-LIMITED REQUEST
          ghlContactId = await rateLimitedRequest(() =>
            findGhlContactByEmailOrPhone(
              owner.email,
              owner.phone,
              account.privateToken,
              account.locationId
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

      const customFields: Record<string, any> = {};
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
        locationId: account.locationId,
      };

      console.debug(
        `📦 [${account.name}] Prepared payload for property ID ${p.id}:`,
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
                Authorization: `Bearer ${account.privateToken}`,
                Accept: "application/json",
                "Content-Type": "application/json",
                Version: API_VERSION,
              },
            }
          )
        );

        // After creating property in GHL, update:
        if (resp.status === 201) {
          const ghlPropertyId = extractGhlId(resp.data);
          if (ghlPropertyId) {
            await prisma.property.update({
              where: { id: p.id },
              data: {
                pushed: account === GHL_ACCOUNTS[0], // Only mark pushed for first account
                ghlPropertyId, // Store GHL ID
              },
            });
          }
        }

        if (resp.status === 201 || resp.status === 200) {
          const ghlPropertyId = extractGhlId(resp.data);
          if (!ghlPropertyId) {
            console.warn(
              `⚠️ Created property ${p.id} but could not find GHL id in response.`
            );
            console.debug(
              "Full resp.data:",
              JSON.stringify(resp.data, null, 2)
            );
          }

          pushedPropertyCount++;
          console.info(`✔ Pushed property ID ${p.id} (GHL: ${ghlPropertyId})`);

          await updateJobProgress(job.id, {
            processed: contactsToPush.size + pushedPropertyCount,
            total: contactsToPush.size + properties.length,
            status: `Pushed ${pushedPropertyCount}/${properties.length} properties`,
          }).catch((err) => console.warn("Progress update failed:", err));

          // Create association
          if (ghlPropertyId && ghlContactId) {
            console.info(
              `🔗 [${account.name}] Associating property ${p.id} (GHL: ${ghlPropertyId}) with contact ${p.ownerId} (GHL: ${ghlContactId})`
            );
            // RATE-LIMITED REQUEST
            await rateLimitedRequest(() =>
              ensureContactPropertyAssociation(
                ghlContactId,
                ghlPropertyId,
                account.privateToken,
                account.locationId
              )
            );
            associationCount++;
          } else {
            console.warn(
              `⚠️ [${account.name}] Skipping association for property ${p.id}: missing GHL IDs`
            );
          }
        } else {
          console.error(
            `✖ [${account.name}] GHL responded ${resp.status} ${resp.statusText} for property ${p.id}`
          );
        }
      } catch (err: any) {
        if (err.response) {
          console.error(
            `❌ [${account.name}] GHL Error for property ID ${p.id}:`,
            {
              status: err.response.status,
              data: err.response.data,
              headers: err.response.headers,
            }
          );
        } else {
          console.error(
            `❌ [${account.name}] Error pushing property ID ${p.id}:`,
            err
          );
        }
      }
    }

    accountResults.properties[account.name] = pushedPropertyCount;
    accountResults.associations[account.name] = associationCount;

    console.info(`\n✅ [${account.name}] Account complete:`);
    console.info(`   📊 Properties pushed: ${pushedPropertyCount}`);
    console.info(
      `   👥 Contacts pushed: ${accountResults.contacts[account.name]}`
    );
    console.info(`   🔗 Associations created: ${associationCount}\n`);
  }

  // Final summary
  console.info(`
========================================
✅ Job ${job.id} COMPLETE - ALL ACCOUNTS
========================================`);

  for (const account of GHL_ACCOUNTS) {
    console.info(`
🏢 ${account.name}:
   📊 Properties: ${accountResults.properties[account.name] || 0}
   👥 Contacts: ${accountResults.contacts[account.name] || 0}
   🔗 Associations: ${accountResults.associations[account.name] || 0}`);
  }

  console.info(`
========================================
  `);
}
