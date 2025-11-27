import axios, { AxiosError } from "axios";
import { PrismaClient } from "@prisma/client";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";
const prisma = new PrismaClient();
const CUSTOM_OBJECT_KEY = "custom_objects.properties";

export async function getAssociationIdBetween(
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

export function extractErrorInfo(err: unknown): {
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

export async function createRelationBetweenRecords(
  associationId: string,
  firstRecordId: string,
  secondRecordId: string,
  privateToken: string,
  locationId: string
): Promise<{
  success: boolean;
  data?: any;
  error?: any;
  alreadyExists?: boolean;
}> {
  if (!associationId || !firstRecordId || !secondRecordId) {
    return { success: false, error: "missing associationId or record ids" };
  }

  const body = {
    locationId,
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
    }

    return { success: false, error: { status: resp.status, data: resp.data } };
  } catch (err: any) {
    const status = err.response?.status;
    const data = err.response?.data;

    // Treat duplicate-relation 400 as success (already associated)
    const message = (data && (data.message || data.error || ""))
      .toString()
      .toLowerCase();
    const isDuplicate =
      status === 400 &&
      (message.includes("duplicate") ||
        message.includes("duplicate relation") ||
        message.includes("duplicate association"));

    if (isDuplicate) {
      return { success: true, data, alreadyExists: true };
    }

    return { success: false, error: data ?? err.message };
  }
}

export async function ensureContactPropertyAssociation(
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

export const toNumber = (v: string | number | null): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
  return isNaN(n) ? null : n;
};

export const toFloat = (v: string | number | null): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : v;
  return isNaN(n) ? null : n;
};

export const normalizeYesNo = (
  value: string | null | undefined
): string | null => {
  if (!value) return null;
  const normalized = value.toString().toLowerCase().trim();
  if (["yes", "true", "1"].includes(normalized)) return "Yes";
  if (["no", "false", "0"].includes(normalized)) return "No";
  return null;
};

export function normalizeWorkingWithRealtor(
  val: string | null | undefined
): "No I am Not" | "Yes, I am" {
  if (!val || val.trim() === "") return "No I am Not";

  const lower = val.trim().toLowerCase();

  if (["no", "n"].includes(lower)) return "No I am Not";
  if (["yes", "y"].includes(lower)) return "Yes, I am";

  return "No I am Not";
}

export function normalizeMLSStatus(
  raw: string | null | undefined
): "TRUE" | "FALSE" | undefined {
  if (!raw) return "FALSE";
  const val = raw.trim().toLowerCase();

  const inactive = ["", "off market", "offmarket", "pa"];
  if (inactive.includes(val)) return "FALSE";

  return "TRUE";
}

export function normalizeLiquidAssets(
  raw: string | null | undefined
): "Below $10k" | "$10k - $20k" | "Over $20k" | undefined {
  if (!raw || raw.trim() === "") return undefined;

  const val = raw.trim().toLowerCase();

  if (val === "yes") return "Over $20k";

  return undefined;
}

export function normalizeHouseholdIncome(
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

export const normalizeLoanType = (
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

export function normalizedLoanType(
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

export function buildTags(
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

export function normalizePropertyType(
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

export function normalizeLeadSource(
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

export function normalizeFreeAndClear(
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

export function extractGhlId(respData: any): string | undefined {
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

export const parkingMapping: Record<string, string> = {
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

export async function findGhlContactByEmailOrPhone(
  email: string | null | undefined,
  phone: string | null | undefined,
  privateToken: string,
  locationId: string
): Promise<string | undefined> {
  console.info(
    `🔍 Searching for existing contact - Email: ${email || "N/A"}, Phone: ${
      phone || "N/A"
    }`
  );

  if (!email && !phone) {
    console.warn(`⚠️ No email or phone provided for contact search`);
    return undefined;
  }

  try {
    const headers = {
      Authorization: `Bearer ${privateToken}`,
      Version: API_VERSION,
      Accept: "application/json",
    };

    // 1️⃣ Try searching by email first (if available)
    if (email) {
      console.debug(`📧 Searching GHL by email: ${email}`);
      try {
        const resp = await axios.get(
          `${GHL_BASE_URL}/contacts/search/duplicate`,
          {
            headers,
            params: {
              locationId,
              email, // Email is already URL-safe in most cases
            },
          }
        );

        const contact = resp.data?.contact || resp.data;
        if (contact?.id) {
          console.info(`✅ Found contact by email: ${contact.id}`);
          return contact.id;
        }
      } catch (emailError: any) {
        const status = emailError.response?.status;

        // 404 means no duplicate found
        if (status === 404) {
          console.debug(`ℹ️ No contact found by email (404)`);
        }
        // 422 validation error
        else if (status === 422) {
          console.warn(
            `⚠️ Email search validation error (422):`,
            emailError.response?.data
          );
        }
        // Other errors
        else {
          console.error(
            `❌ Email search failed with status ${status}:`,
            emailError.response?.data || emailError.message
          );
          if (status === 401 || status === 403) {
            throw emailError;
          }
        }
      }
    }

    // 2️⃣ Try searching by phone using 'number' parameter (if email search failed)
    if (phone) {
      console.debug(`📱 Searching GHL by phone: ${phone}`);
      try {
        const resp = await axios.get(
          `${GHL_BASE_URL}/contacts/search/duplicate`,
          {
            headers,
            params: {
              locationId,
              number: phone, // Note: parameter is 'number' not 'phone'
            },
            // Axios automatically URL-encodes params
          }
        );

        const contact = resp.data?.contact || resp.data;
        if (contact?.id) {
          console.info(`✅ Found contact by phone: ${contact.id}`);
          return contact.id;
        }
      } catch (phoneError: any) {
        const status = phoneError.response?.status;

        // 404 means no duplicate found
        if (status === 404) {
          console.debug(`ℹ️ No contact found by phone (404)`);
        }
        // 422 validation error
        else if (status === 422) {
          console.warn(
            `⚠️ Phone search validation error (422):`,
            phoneError.response?.data
          );
        }
        // Other errors
        else {
          console.error(
            `❌ Phone search failed with status ${status}:`,
            phoneError.response?.data || phoneError.message
          );
          if (status === 401 || status === 403) {
            throw phoneError;
          }
        }
      }
    }

    console.info(
      `ℹ️ Contact not found in GHL (this is normal for new contacts)`
    );
    return undefined;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    const status = (e as any).response?.status;

    console.error(`❌ Critical error searching for contact:`, {
      error: errorMsg,
      status,
      email: email || "N/A",
      phone: phone || "N/A",
      responseData: (e as any).response?.data,
    });

    // Re-throw auth errors so the job stops
    if (status === 401 || status === 403) {
      throw e;
    }

    return undefined;
  }
}

export async function findGhlPropertyByAddress(
  address: string | null,
  privateToken: string,
  locationId: string
): Promise<string | undefined> {
  if (!address) {
    console.debug(`⚠️ No address provided for property search`);
    return undefined;
  }

  console.info(`🏠 Searching for existing property: ${address}`);

  try {
    const headers = {
      Authorization: `Bearer ${privateToken}`,
      Version: API_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    // Use POST to search custom object records
    // Note: Make sure "address" is configured as a searchable property in your custom object schema
    const resp = await axios.post(
      `${GHL_BASE_URL}/objects/${CUSTOM_OBJECT_KEY}/records/search`,
      {
        locationId,
        page: 1,
        pageLimit: 1, // Only need the first match
        query: address, // Search by address - ensure address is a searchable property
      },
      {
        headers,
      }
    );

    const records = resp.data?.records || [];

    if (records.length > 0 && records[0]?.id) {
      console.info(`✅ Found existing property: ${records[0].id}`);
      return records[0].id;
    }

    console.debug(`ℹ️ No property found with address: ${address}`);
    return undefined;
  } catch (error: any) {
    const status = error.response?.status;
    const errorData = error.response?.data;

    // Log different error types
    if (status === 404) {
      console.debug(`ℹ️ No property found (404)`);
    } else if (status === 400) {
      console.warn(`⚠️ Bad request searching for property:`, errorData);
      // This might mean 'address' is not configured as a searchable property
    } else if (status === 422) {
      console.warn(`⚠️ Validation error searching for property:`, errorData);
    } else if (status === 401 || status === 403) {
      console.error(
        `❌ Authentication error searching for property:`,
        errorData
      );
      throw error; // Re-throw auth errors
    } else {
      console.error(`❌ Error searching for property:`, {
        status,
        error: errorData || error.message,
        address,
      });
    }

    return undefined;
  }
}
