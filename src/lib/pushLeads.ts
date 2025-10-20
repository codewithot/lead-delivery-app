import { PrismaClient, type Job, type UserSettings } from "@prisma/client";
import axios, { AxiosError } from "axios";
import { normalizeCountry, normalizePostalCode } from "./normalizeCountry.ts";

const prisma = new PrismaClient();
const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const CUSTOM_OBJECT_KEY = "custom_objects.properties";
const API_VERSION = "2021-07-28";

// Multi-account configuration
const GHL_ACCOUNTS = [
  {
    name: "ProEdge Sandbox",
    locationId: process.env.GHL_LOCATION_ID || "FmyBGGVhzMmKaYko3PsW",
    privateToken:
      process.env.GHL_PRIVATE_TOKEN ||
      "pit-04ee49b1-2e1c-4276-ba9c-7e20b3cacb3c",
  },
  {
    name: "SmartytheRealtor",
    locationId:
      process.env.GHL_LOCATION_IDsmartytheRealtor || "P4Rt72mIVJCPh4w5FHRt",
    privateToken:
      process.env.GHL_PRIVATE_TOKENsmartytheRealtor ||
      "pit-b1652b14-6a49-4c64-91d6-74dffe481cbc",
  },
  {
    name: "Direct One Home Buyers",
    locationId:
      process.env.GHL_LOCATION_IDdirectOneHomeBuyers || "3eqjaHp2WwPxvUWCV9Mb",
    privateToken:
      process.env.GHL_PRIVATE_TOKENdirectOneHomeBuyers ||
      "pit-f6adc9b4-0de0-4911-a09b-ff57cb9b3a41",
  },
];

function extractErrorInfo(err: unknown): {
  message: string;
  status?: number;
  data?: any;
  headers?: any;
} {
  // Axios error
  if (axios.isAxiosError(err)) {
    const ae = err as AxiosError;
    return {
      message: ae.message ?? "Axios error",
      status: ae.response?.status,
      data: ae.response?.data,
      headers: ae.response?.headers,
    };
  }

  // Native Error
  if (err instanceof Error) {
    return { message: err.message };
  }

  // Fallback
  try {
    return { message: String(err) };
  } catch {
    return { message: "Unknown error" };
  }
}

async function getAssociationIdBetween(
  firstObjectKey: string,
  secondObjectKey: string,
  privateToken: string,
  locationId: string
): Promise<string | undefined> {
  try {
    const resp = await axios.get(
      `${GHL_BASE_URL}/associations/objectKey/${encodeURIComponent(
        firstObjectKey
      )}`,
      {
        headers: {
          Authorization: `Bearer ${privateToken}`,
          Version: API_VERSION,
          Accept: "application/json",
        },
        params: {
          locationId: locationId,
        },
      }
    );

    if (!Array.isArray(resp.data)) {
      const list = resp.data?.associations ?? resp.data;
      if (!Array.isArray(list)) {
        console.warn("Unexpected associations response shape:", resp.data);
        return undefined;
      }
      for (const a of list) {
        if (
          (a.firstObjectKey === firstObjectKey &&
            a.secondObjectKey === secondObjectKey) ||
          (a.firstObjectKey === secondObjectKey &&
            a.secondObjectKey === firstObjectKey)
        ) {
          return a.id || a._id || a.associationId;
        }
      }
      return undefined;
    }

    // resp.data is an array
    for (const a of resp.data) {
      if (
        (a.firstObjectKey === firstObjectKey &&
          a.secondObjectKey === secondObjectKey) ||
        (a.firstObjectKey === secondObjectKey &&
          a.secondObjectKey === firstObjectKey)
      ) {
        return a.id || a._id || a.associationId;
      }
    }

    return undefined;
  } catch (err: any) {
    console.error(
      "Error fetching associations:",
      err.response?.status ?? err.message
    );
    return undefined;
  }
}

async function createRelationBetweenRecords(
  associationId: string,
  firstRecordId: string,
  secondRecordId: string,
  privateToken: string,
  locationId: string
): Promise<{ success: boolean; data?: any; error?: any }> {
  if (!associationId || !firstRecordId || !secondRecordId) {
    return { success: false, error: "missing associationId or record ids" };
  }

  const body = {
    locationId: locationId,
    associationId,
    firstRecordId,
    secondRecordId,
  };

  try {
    const resp = await axios.post(
      `${GHL_BASE_URL}/associations/relations`,
      body,
      {
        headers: {
          Authorization: `Bearer ${privateToken}`,
          Version: API_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    if (resp.status === 201 || resp.status === 200) {
      return { success: true, data: resp.data };
    } else {
      return {
        success: false,
        error: { status: resp.status, data: resp.data },
      };
    }
  } catch (err: any) {
    return { success: false, error: err.response?.data ?? err.message };
  }
}

async function ensureContactPropertyAssociation(
  contactGhlId: string,
  propertyGhlId: string,
  privateToken: string,
  locationId: string
): Promise<void> {
  if (!contactGhlId || !propertyGhlId) {
    console.warn("Skipping association — missing GHL ids", {
      contactGhlId,
      propertyGhlId,
    });
    return;
  }

  const assocId = await getAssociationIdBetween(
    "contact",
    CUSTOM_OBJECT_KEY,
    privateToken,
    locationId
  );
  if (!assocId) {
    console.error(
      "No association definition found for contact <",
      CUSTOM_OBJECT_KEY,
      ">"
    );
    return;
  }

  let contactName: string | undefined;

  try {
    const local = await prisma.contact.findUnique({
      where: { ghlContactId: contactGhlId },
      select: {
        firstName: true,
        lastName: true,
        companyName: true,
        email: true,
      },
    });

    if (local) {
      const full = `${local.firstName ?? ""} ${local.lastName ?? ""}`.trim();
      contactName = full || local.companyName || local.email || undefined;
    }
  } catch (e) {
    const info = extractErrorInfo(e);
    console.debug(
      "Warning: local DB lookup for contact name failed:",
      info.message
    );
  }

  if (!contactName) {
    try {
      const resp = await axios.get(
        `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactGhlId)}`,
        {
          headers: {
            Authorization: `Bearer ${privateToken}`,
            Version: API_VERSION,
            Accept: "application/json",
          },
        }
      );

      const c = resp.data?.contact ?? resp.data;
      const first = (c?.firstName ?? c?.first_name ?? "") as string;
      const last = (c?.lastName ?? c?.last_name ?? "") as string;
      const full = `${first} ${last}`.trim();

      contactName =
        full ||
        c?.name ||
        c?.companyName ||
        c?.company_name ||
        c?.email ||
        contactGhlId;
    } catch (err: unknown) {
      const info = extractErrorInfo(err);
      console.debug(
        "Warning: fetching contact from GHL failed:",
        info.status ?? info.message ?? String(err)
      );
      contactName = contactGhlId;
    }
  }

  try {
    const res = await createRelationBetweenRecords(
      assocId,
      contactGhlId,
      propertyGhlId,
      privateToken,
      locationId
    );

    if (res?.success) {
      console.info("🔗 Associated contact <> property", {
        contactName,
        contactGhlId,
        propertyGhlId,
      });
    } else {
      console.error("❌ Could not create relation:", res?.error ?? res, {
        contactName,
        contactGhlId,
        propertyGhlId,
      });
    }
  } catch (err: unknown) {
    const info = extractErrorInfo(err);
    console.error("❌ Error creating relation:", {
      status: info.status,
      data: info.data ?? info.message,
      contactName,
      contactGhlId,
      propertyGhlId,
    });
  }
}

const toNumber = (v: string | number | null): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
  return isNaN(n) ? null : n;
};

const toFloat = (v: string | number | null): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : v;
  return isNaN(n) ? null : n;
};

const normalizeYesNo = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.toString().toLowerCase().trim();
  if (["yes", "true", "1"].includes(normalized)) return "Yes";
  if (["no", "false", "0"].includes(normalized)) return "No";
  return null;
};

function normalizeWorkingWithRealtor(
  val: string | null | undefined
): "No I am Not" | "Yes, I am" {
  if (!val || val.trim() === "") return "No I am Not";

  const lower = val.trim().toLowerCase();

  if (["no", "n"].includes(lower)) return "No I am Not";
  if (["yes", "y"].includes(lower)) return "Yes, I am";

  return "No I am Not";
}

function normalizeMLSStatus(
  raw: string | null | undefined
): "TRUE" | "FALSE" | undefined {
  if (!raw) return "FALSE";
  const val = raw.trim().toLowerCase();

  const inactive = ["", "off market", "offmarket", "pa"];
  if (inactive.includes(val)) return "FALSE";

  return "TRUE";
}

function normalizeLiquidAssets(
  raw: string | null | undefined
): "Below $10k" | "$10k - $20k" | "Over $20k" | undefined {
  if (!raw || raw.trim() === "") return undefined;

  const val = raw.trim().toLowerCase();

  if (val === "yes") return "Over $20k";

  return undefined;
}

function normalizeHouseholdIncome(
  value: string | number | undefined | null
): string | undefined {
  if (value === undefined || value === null) return undefined;

  let numValue: number;

  if (typeof value === "string") {
    numValue = Number(value.replace(/[\$,]/g, ""));
  } else {
    numValue = value;
  }

  if (numValue < 65000) return "Below $65k";
  if (numValue <= 90000) return "65k - 90k";
  return "Above 90k";
}

const normalizeLoanType = (
  value: string | null | undefined
):
  | "conventional"
  | "arm"
  | "fha"
  | "usda"
  | "va"
  | "building_or_construction"
  | "not_available"
  | undefined => {
  if (!value) return undefined;

  const v = value.toString().trim().replace(/\s+/g, " ").toLowerCase();

  if (
    v === "conventional" ||
    v === "conventional with pmi" ||
    v === "conventional\t" ||
    v === "conventional\t"
  ) {
    return "conventional";
  }
  if (
    v === "arm" ||
    v.includes("adjustable rate mortgage") ||
    v.startsWith("arm")
  ) {
    return "arm";
  }
  if (v === "fha" || v === "fha ") {
    return "fha";
  }
  if (v === "usda") {
    return "usda";
  }
  if (
    v === "va" ||
    v.includes("veterans") ||
    v.includes("veterans administration") ||
    v.includes("veterans admin")
  ) {
    return "va";
  }
  if (
    v === "building or construction" ||
    v === "building_or_construction" ||
    v === "construction"
  ) {
    return "building_or_construction";
  }

  const notAvail = new Set([
    "not available",
    "not_available",
    "n/a",
    "#n/a",
    "na",
    "unknown",
  ]);
  if (notAvail.has(v)) return "not_available";

  if (v === "" || v === "0" || v === "none") return undefined;

  return undefined;
};

function normalizedLoanType(
  raw: string | null | undefined
): string | undefined {
  if (!raw) return undefined;
  const val = raw.trim().toLowerCase();

  if (["conventional", "conventional with pmi", "conventional\t"].includes(val))
    return "Conventional";
  if (["fha", "fha"].includes(val)) return "FHA";
  if (
    ["va", "veterans administration", "veterans administration"].includes(val)
  )
    return "VA";
  if (["usda"].includes(val)) return "USDA";
  if (["jumbo"].includes(val)) return "Jumbo";

  return undefined;
}

function buildTags(
  input?: string | string[] | null,
  existingContactTags?: string | string[] | null,
  tagToAdd = "Seller"
): string[] | undefined {
  const normalizeSource = (src?: string | string[] | null): string[] => {
    if (!src) return [];
    if (Array.isArray(src)) return src.map((s) => String(s));
    return String(src)
      .split(/[,;\n\r]+/)
      .map((s) => String(s));
  };

  const inputArr = normalizeSource(input).map((s) =>
    s.replace(/\s+/g, " ").trim()
  );
  const existingArr = normalizeSource(existingContactTags).map((s) =>
    s.replace(/\s+/g, " ").trim()
  );

  const map = new Map<string, string>();
  for (const t of [...existingArr, ...inputArr]) {
    const key = t.trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, t);
  }

  const addKey = tagToAdd.trim().toLowerCase();
  if (!map.has(addKey)) {
    map.set(addKey, tagToAdd);
  }

  const result = Array.from(map.values()).map((s) => s.trim());
  return result.length ? result : undefined;
}

function normalizePropertyType(
  input: string | null | undefined
): string | null {
  if (!input) return null;

  const value = input.trim().toLowerCase();

  const mappings: Record<string, string | null> = {
    "single family": "single_family",
    "single family residence": "single_family",
    "single-family home": "single_family",
    sfr: "single_family",
    residential: "single_family",

    "town home": "town_home",
    townhouse: "town_home",
    "row house": "town_home",
    "condominium / townhouse": "town_home",
    "condo/townhouse": "town_home",

    condominium: "condominium",
    "condominium ": "condominium",
    condo: "condominium",

    duplex: "duplex",
    "duplex ": "duplex",

    triplex: "triplex",
    "tri-plex": "triplex",

    quadplex: "quadplex",
    "quad-plex": "quadplex",

    "multi family": null,
    "multi-family": null,
    "multi-family 2-4 units": null,
    "multi-family 5+ units": null,
    "multi-family dwellings": null,

    apartment: null,
    apartments: null,

    commercial: null,
    "commercial average": null,
    land: null,
    "vacant land": null,
    "mobile home": null,
    other: null,
    "not available": null,
  };

  return mappings[value] ?? null;
}

function normalizeLeadSource(
  value: string | null | undefined
): string | undefined {
  const options = [
    "Saw Sign",
    "On Zillow",
    "Redfin",
    "Home.com",
    "Facebook Marketplace",
    "Other",
  ];
  if (!value) return undefined;
  return options.find((opt) => opt.toLowerCase() === value.toLowerCase());
}

function normalizeFreeAndClear(
  value: string | boolean | undefined | null
): "TRUE" | "FALSE" | undefined | null {
  if (value === undefined || value === null) return value;

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "yes" || v === "true") return "TRUE";
    if (v === "no" || v === "false") return "FALSE";
  }

  return undefined;
}

function extractGhlId(respData: any): string | undefined {
  if (!respData) return undefined;
  return (
    respData.id ||
    respData.data?.id ||
    respData.record?.id ||
    respData.data?.record?.id ||
    respData.contact?.id ||
    undefined
  );
}

const parkingMapping: Record<string, string> = {
  no: "No Parking",
  No: "No Parking",
  NO: "No Parking",
  "": "No Parking",
  "0": "No Parking",
  None: "No Parking",
  Unknown: "No Parking",

  "Garage - Attached": "Garage - Attached",
  "Garage Attached": "Garage - Attached",
  "Attached Garage": "Garage - Attached",
  "Garage, Attached": "Garage - Attached",
  "Garage Faces Front": "Garage - Attached",
  "Garage Faces Rear, Attached": "Garage - Attached",

  "Garage - Detached": "Garage - Detached",
  "Garage Detached": "Garage - Detached",
  "Garage, Detached": "Garage - Detached",

  Driveway: "Driveway",
  "Private, Detached Carport": "Driveway",
  "Inside Entrance, Private, Driveway, Attached, Other": "Driveway",

  "On Street": "On Street",
  "On-street": "On Street",
  "On-Street": "On Street",
  "on street": "On Street",

  "Off Street": "Off Street",
  "Off-street": "Off Street",
  "Off-Street": "Off Street",

  "Parking Lot": "Parking Lot",
  "Unassigned, Parking Lot": "Parking Lot",

  Carport: "Carport",
  Other: "Other",
  Yes: "Other",
  Storage: "Other",
  "Garage Open": "Other",
  "Garage Door Opener": "Other",
  "Garage Basement": "Other",
  "Garage Attached On Street": "Other",
  "Inside Entrance, Attached,": "Other",
};

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

    // ========================================================================
    // STEP 3: Push contacts first
    // We need their GHL IDs to create associations later
    // ========================================================================
    for (const [contactId, contact] of contactsToPush) {
      const existingGhlId = await findGhlContactByEmailOrPhone(
        contact.email,
        contact.phone,
        account.privateToken,
        account.locationId
      );

      if (existingGhlId) {
        console.info(`Found existing contact in GHL: ${existingGhlId}`);
        contactIdMap[contact.id] = existingGhlId;
        continue; // Skip creation
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
        const resp = await axios.post(
          `${GHL_BASE_URL}/contacts/`,
          contactPayload,
          {
            headers: {
              Authorization: `Bearer ${account.privateToken}`,
              Accept: "application/json",
              "Content-Type": "application/json",
              Version: API_VERSION,
            },
          }
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
      const existingGhlId = await findGhlPropertyByAddress(
        p.addressFull,
        account.privateToken,
        account.locationId
      );

      if (existingGhlId) {
        console.info(`Found existing property in GHL: ${existingGhlId}`);
        // Use existing ID for associations
        continue; // Skip creation
      }
      if (!p.ownerId) {
        console.warn(`⚠️ Property ID ${p.id} has no ownerId, skipping`);
        continue;
      }

      const ghlContactId = contactIdMap[p.ownerId];
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
        const resp = await axios.post(
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
        );

        // After creating property in GHL, update:
        if (resp.status === 201) {
          const ghlPropertyId = extractGhlId(resp.data);
          if (ghlPropertyId) {
            // Update local DB with GHL ID
            await prisma.property.update({
              where: { id: p.id },
              data: {
                pushed: account === GHL_ACCOUNTS[0],
                ghlPropertyId,
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

          if (account === GHL_ACCOUNTS[0]) {
            await prisma.property.update({
              where: { id: p.id },
              data: { pushed: true },
            });
          }

          pushedPropertyCount++;
          console.info(`✔ Pushed property ID ${p.id} (GHL: ${ghlPropertyId})`);

          // Create association
          if (ghlPropertyId && ghlContactId) {
            console.info(
              `🔗 [${account.name}] Associating property ${p.id} (GHL: ${ghlPropertyId}) with contact ${p.ownerId} (GHL: ${ghlContactId})`
            );
            await ensureContactPropertyAssociation(
              ghlContactId,
              ghlPropertyId,
              account.privateToken,
              account.locationId
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

async function findGhlContactByEmailOrPhone(
  email: string | null | undefined,
  phone: string | null | undefined,
  privateToken: string,
  locationId: string
): Promise<string | undefined> {
  try {
    if (email) {
      const resp = await axios.get(`${GHL_BASE_URL}/contacts/`, {
        headers: {
          Authorization: `Bearer ${privateToken}`,
          Version: API_VERSION,
        },
        params: { locationId, email },
      });
      if (resp.data?.contacts?.[0]?.id) return resp.data.contacts[0].id;
    }
    if (phone) {
      const resp = await axios.get(`${GHL_BASE_URL}/contacts/`, {
        headers: {
          Authorization: `Bearer ${privateToken}`,
          Version: API_VERSION,
        },
        params: { locationId, phone },
      });
      if (resp.data?.contacts?.[0]?.id) return resp.data.contacts[0].id;
    }
  } catch (e) {
    // Ignore search errors
  }
  return undefined;
}

async function findGhlPropertyByAddress(
  address: string | null, // Allow null
  privateToken: string,
  locationId: string
): Promise<string | undefined> {
  if (!address) return undefined; // Early return if null

  try {
    const resp = await axios.get(
      `${GHL_BASE_URL}/objects/${CUSTOM_OBJECT_KEY}/records`,
      {
        headers: {
          Authorization: `Bearer ${privateToken}`,
          Version: API_VERSION,
        },
        params: { locationId, query: address },
      }
    );
    if (resp.data?.records?.[0]?.id) return resp.data.records[0].id;
  } catch (e) {
    // Ignore search errors
  }
  return undefined;
}
