import axios from "axios";
import { PrismaClient } from "@prisma/client";
const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";
const prisma = new PrismaClient();
const CUSTOM_OBJECT_KEY = "custom_objects.properties";
import { normalizeEmail, normalizePhone, normalizeAddress, normalizeAddressForFuzzyMatch, } from "./normalizers";
let countriesLib = null;
try {
    // optional, best-effort: use i18n-iso-countries if installed
    // this package improves matching and supports many languages/aliases
    // If you install it, the code will register 'en' locale automatically.
    // NOTE: If you need other locales (fr, es...) register them similarly.
    //   const countries = require("i18n-iso-countries");
    //   countries.registerLocale(require("i18n-iso-countries/langs/en.json"));
    //   ...
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    countriesLib = require("i18n-iso-countries");
    try {
        // try to register English locale if not already registered
        // (some environments require explicit registration)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        countriesLib.registerLocale(require("i18n-iso-countries/langs/en.json"));
    }
    catch {
        // ignore — may already be registered or not available
    }
}
catch {
    countriesLib = null;
}
// Small alpha3 -> alpha2 map for common codes (fallback)
const ALPHA3_TO_ALPHA2 = {
    USA: "US",
    GBR: "GB",
    CAN: "CA",
    AUS: "AU",
    DEU: "DE",
    FRA: "FR",
    ESP: "ES",
    ITA: "IT",
    MEX: "MX",
    BRA: "BR",
    CHN: "CN",
    RUS: "RU",
    IND: "IN",
    JPN: "JP",
    KOR: "KR",
    ZAF: "ZA",
    NLD: "NL",
    CHE: "CH",
    SWE: "SE",
    NOR: "NO",
    DNK: "DK",
    BEL: "BE",
    AUT: "AT",
    POL: "PL",
    TUR: "TR",
    IRL: "IE",
    NZL: "NZ",
    SGP: "SG",
    HKG: "HK",
    TWN: "TW",
    ARE: "AE",
    SAU: "SA",
    ARG: "AR",
    COL: "CO",
    CHL: "CL",
    PRT: "PT",
    GRC: "GR",
    HUN: "HU",
    // add more if you want
};
// A fallback alias map (common names, local names, misspellings -> alpha-2)
const ALIASES = {
    // United States
    usa: "US",
    "u.s.": "US",
    "u.s.a.": "US",
    "united states": "US",
    "united states of america": "US",
    america: "US",
    "estad os unidos": "US",
    "estados unidos": "US",
    "estados unidos de america": "US",
    eeuu: "US",
    us: "US",
    // United Kingdom / Great Britain
    uk: "GB",
    "united kingdom": "GB",
    "great britain": "GB",
    england: "GB",
    scotland: "GB",
    wales: "GB",
    "northern ireland": "GB",
    britain: "GB",
    gb: "GB",
    // Canada
    canada: "CA",
    ca: "CA",
    // Australia
    australia: "AU",
    au: "AU",
    // Germany
    germany: "DE",
    deutschland: "DE",
    de: "DE",
    // France
    france: "FR",
    fr: "FR",
    // Spain
    spain: "ES",
    españa: "ES",
    es: "ES",
    // Italy
    italy: "IT",
    italia: "IT",
    it: "IT",
    // Mexico
    mexico: "MX",
    méxico: "MX",
    mx: "MX",
    // China
    china: "CN",
    prc: "CN",
    "people's republic of china": "CN",
    cn: "CN",
    // India
    india: "IN",
    bharat: "IN",
    in: "IN",
    // Japan
    japan: "JP",
    nihon: "JP",
    nippon: "JP",
    jp: "JP",
    // South Korea
    "south korea": "KR",
    "korea, republic of": "KR",
    korea: "KR",
    kr: "KR",
    // Brazil
    brazil: "BR",
    brasil: "BR",
    br: "BR",
    // Russia
    russia: "RU",
    "russian federation": "RU",
    ru: "RU",
    // Netherlands
    netherlands: "NL",
    holland: "NL",
    nl: "NL",
    // Sweden
    sweden: "SE",
    se: "SE",
    // Norway
    norway: "NO",
    no: "NO",
    // Switzerland
    switzerland: "CH",
    che: "CH",
    ch: "CH",
    // Turkey
    turkey: "TR",
    tr: "TR",
    // Ireland
    ireland: "IE",
    ie: "IE",
    // South Africa
    "south africa": "ZA",
    za: "ZA",
    // Add more aliases as you discover them...
};
// Helper: normalize text (strip punctuation, diacritics lightly)
function _normalizeTextForMatch(input) {
    if (!input)
        return "";
    let s = String(input).trim();
    // remove punctuation commonly used in country abbreviations/names
    s = s.replace(/[.,'`"]/g, "");
    // collapse multiple spaces, parentheses, / and -
    s = s.replace(/[\u2013\u2014\-\/\\]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    // lower-case for alias lookup
    return s.toLowerCase();
}
/**
 * normalizeCountry(value) -> returns ISO alpha-2 string (e.g. "US") or null if unknown
 */
export function normalizeCountry(value) {
    if (value === null || value === undefined)
        return null;
    const raw = String(value).trim();
    if (!raw)
        return null;
    // If already 2-letter code
    const lettersOnly = raw.replace(/[^A-Za-z]/g, "");
    if (lettersOnly.length === 2) {
        const code2 = lettersOnly.toUpperCase();
        // quick sanity: if using countriesLib we can verify; else return uppercase
        if (countriesLib) {
            if (countriesLib.isValid(code2))
                return code2;
        }
        else {
            // accept likely valid codes (we can't verify comprehensive list without library)
            return code2;
        }
    }
    // If 3-letter alpha-3 code like "USA" -> map to alpha2
    if (lettersOnly.length === 3) {
        const code3 = lettersOnly.toUpperCase();
        if (countriesLib) {
            // try via library: get alpha2 code from alpha3 (i18n-iso-countries provides alpha3ToAlpha2 only indirectly)
            try {
                // try to find by iterating registered codes
                const allAlpha2 = Object.keys(countriesLib.getNames("en"));
                for (const alpha2 of allAlpha2) {
                    const alpha3 = countriesLib.alpha2ToAlpha3(alpha2);
                    if (alpha3 === code3)
                        return alpha2;
                }
            }
            catch {
                // ignore
            }
        }
        if (ALPHA3_TO_ALPHA2[code3])
            return ALPHA3_TO_ALPHA2[code3];
    }
    // Try countriesLib by name (best option)
    if (countriesLib) {
        // try as-is (English)
        const asName = raw;
        const code = countriesLib.getAlpha2Code(asName, "en");
        if (code)
            return code;
        // try normalized lower-case name
        const normalized = _normalizeTextForMatch(raw);
        // try several heuristics: Title Case / start-case
        const title = normalized
            .split(" ")
            .map((t) => (t.length ? t[0].toUpperCase() + t.slice(1) : ""))
            .join(" ");
        const code2 = countriesLib.getAlpha2Code(title, "en");
        if (code2)
            return code2;
        // fallback: loop names to find substring matches (slower but helpful)
        try {
            const names = countriesLib.getNames("en"); // { "US": "United States", ... }
            for (const [alpha2, englishName] of Object.entries(names)) {
                const n1 = englishName.toLowerCase();
                if (n1 === normalized ||
                    n1.includes(normalized) ||
                    normalized.includes(n1)) {
                    return alpha2;
                }
            }
        }
        catch {
            // ignore
        }
    }
    // fallback alias map
    const key = _normalizeTextForMatch(raw);
    if (ALIASES[key])
        return ALIASES[key];
    // some fuzzy checks: if input includes country code or name as word
    // ex: "United States (USA)" or "USA - United States"
    const keyWords = key.split(/\s+/).filter(Boolean);
    for (const kw of keyWords) {
        if (ALIASES[kw])
            return ALIASES[kw];
        // also check alpha3 map
        const up = kw.toUpperCase();
        if (ALPHA3_TO_ALPHA2[up])
            return ALPHA3_TO_ALPHA2[up];
        if (up.length === 2) {
            if (countriesLib && countriesLib.isValid(up))
                return up;
        }
    }
    // If still unknown, return null
    return null;
}
/**
 * normalizeCountriesBulk(arr)
 * returns an object { original -> normalized } and also counts of normalized values
 */
export function normalizeCountriesBulk(values) {
    const map = {};
    const counts = {};
    for (const v of values) {
        const normalized = normalizeCountry(v);
        map[String(v)] = normalized;
        if (normalized)
            counts[normalized] = (counts[normalized] || 0) + 1;
    }
    return { map, counts };
}
export function normalizePostalCode(postalCode, countryCode = "US") {
    if (!postalCode)
        return null;
    const pc = postalCode.toString().trim().toUpperCase();
    switch (countryCode) {
        case "US": {
            // Match ZIP or ZIP+4
            const zipMatch = pc.match(/^(\d{5})(?:[-\s]?(\d{4}))?$/);
            if (zipMatch) {
                const base = zipMatch[1].padStart(5, "0");
                if (zipMatch[2]) {
                    return `${base}-${zipMatch[2]}`;
                }
                return base;
            }
            return null; // reject invalid US ZIPs
        }
        case "CA": {
            // Canadian postal code: ANA NAN
            const caMatch = pc
                .replace(/\s+/g, "")
                .match(/^([A-Z]\d[A-Z])(\d[A-Z]\d)$/);
            if (caMatch) {
                return `${caMatch[1]} ${caMatch[2]}`;
            }
            return null;
        }
        case "GB": {
            // UK formats (very loose)
            const gbMatch = pc
                .replace(/\s+/g, "")
                .match(/^([A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/);
            if (gbMatch) {
                // put the space before last 3 chars
                return gbMatch[1].slice(0, -3) + " " + gbMatch[1].slice(-3);
            }
            return null;
        }
        default:
            // For unknown countries: just return trimmed uppercase
            return pc;
    }
}
export async function getAssociationIdBetween(firstObjectKey, secondObjectKey, privateToken, locationId) {
    try {
        const resp = await axios.get(`${GHL_BASE_URL}/associations/objectKey/${encodeURIComponent(firstObjectKey)}`, {
            headers: {
                Authorization: `Bearer ${privateToken}`,
                Version: API_VERSION,
                Accept: "application/json",
            },
            params: {
                locationId: locationId,
            },
        });
        if (!Array.isArray(resp.data)) {
            const list = resp.data?.associations ?? resp.data;
            if (!Array.isArray(list)) {
                console.warn("Unexpected associations response shape:", resp.data);
                return undefined;
            }
            for (const a of list) {
                if ((a.firstObjectKey === firstObjectKey &&
                    a.secondObjectKey === secondObjectKey) ||
                    (a.firstObjectKey === secondObjectKey &&
                        a.secondObjectKey === firstObjectKey)) {
                    return a.id || a._id || a.associationId;
                }
            }
            return undefined;
        }
        // resp.data is an array
        for (const a of resp.data) {
            if ((a.firstObjectKey === firstObjectKey &&
                a.secondObjectKey === secondObjectKey) ||
                (a.firstObjectKey === secondObjectKey &&
                    a.secondObjectKey === firstObjectKey)) {
                return a.id || a._id || a.associationId;
            }
        }
        return undefined;
    }
    catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const axiosError = axios.isAxiosError(err) ? err : null;
        console.error("Error fetching associations:", axiosError?.response?.status ?? error.message);
        return undefined;
    }
}
export function extractErrorInfo(err) {
    // Axios error
    if (axios.isAxiosError(err)) {
        const ae = err;
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
    }
    catch {
        return { message: "Unknown error" };
    }
}
export async function createRelationBetweenRecords(associationId, firstRecordId, secondRecordId, privateToken, locationId) {
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
        const resp = await axios.post(`${GHL_BASE_URL}/associations/relations`, body, {
            headers: {
                Authorization: `Bearer ${privateToken}`,
                Version: API_VERSION,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
        });
        if (resp.status === 201 || resp.status === 200) {
            return { success: true, data: resp.data };
        }
        return { success: false, error: { status: resp.status, data: resp.data } };
    }
    catch (err) {
        const axiosError = axios.isAxiosError(err) ? err : null;
        const error = err instanceof Error ? err : null;
        const status = axiosError?.response?.status;
        const data = axiosError?.response?.data;
        // Treat duplicate-relation 400 as success (already associated)
        const message = (data && (data.message || data.error || ""))
            .toString()
            .toLowerCase();
        const isDuplicate = status === 400 &&
            (message.includes("duplicate") ||
                message.includes("duplicate relation") ||
                message.includes("duplicate association"));
        if (isDuplicate) {
            return { success: true, data, alreadyExists: true };
        }
        return { success: false, error: data ?? error?.message ?? String(err) };
    }
}
export async function ensureContactPropertyAssociation(contactGhlId, propertyGhlId, privateToken, locationId) {
    if (!contactGhlId || !propertyGhlId) {
        console.warn("Skipping association — missing GHL ids", {
            contactGhlId,
            propertyGhlId,
        });
        return;
    }
    const assocId = await getAssociationIdBetween("contact", CUSTOM_OBJECT_KEY, privateToken, locationId);
    if (!assocId) {
        console.error("No association definition found for contact <", CUSTOM_OBJECT_KEY, ">");
        return;
    }
    let contactName;
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
    }
    catch (e) {
        const info = extractErrorInfo(e);
        console.debug("Warning: local DB lookup for contact name failed:", info.message);
    }
    if (!contactName) {
        try {
            const resp = await axios.get(`${GHL_BASE_URL}/contacts/${encodeURIComponent(contactGhlId)}`, {
                headers: {
                    Authorization: `Bearer ${privateToken}`,
                    Version: API_VERSION,
                    Accept: "application/json",
                },
            });
            const c = resp.data?.contact ?? resp.data;
            const first = (c?.firstName ?? c?.first_name ?? "");
            const last = (c?.lastName ?? c?.last_name ?? "");
            const full = `${first} ${last}`.trim();
            contactName =
                full ||
                    c?.name ||
                    c?.companyName ||
                    c?.company_name ||
                    c?.email ||
                    contactGhlId;
        }
        catch (err) {
            const info = extractErrorInfo(err);
            console.debug("Warning: fetching contact from GHL failed:", info.status ?? info.message ?? String(err));
            contactName = contactGhlId;
        }
    }
    try {
        const res = await createRelationBetweenRecords(assocId, contactGhlId, propertyGhlId, privateToken, locationId);
        if (res?.success) {
            console.info("🔗 Associated contact <> property", {
                contactName,
                contactGhlId,
                propertyGhlId,
            });
        }
        else {
            console.error("❌ Could not create relation:", res?.error ?? res, {
                contactName,
                contactGhlId,
                propertyGhlId,
            });
        }
    }
    catch (err) {
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
export const toNumber = (v) => {
    if (v === null || v === undefined || v === "")
        return null;
    const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
    return isNaN(n) ? null : n;
};
export const toFloat = (v) => {
    if (v === null || v === undefined || v === "")
        return null;
    const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : v;
    return isNaN(n) ? null : n;
};
export const normalizeYesNo = (value) => {
    if (!value)
        return null;
    const normalized = value.toString().toLowerCase().trim();
    if (["yes", "true", "1"].includes(normalized))
        return "Yes";
    if (["no", "false", "0"].includes(normalized))
        return "No";
    return null;
};
export function normalizeWorkingWithRealtor(val) {
    if (!val || val.trim() === "")
        return "No I am Not";
    const lower = val.trim().toLowerCase();
    if (["no", "n"].includes(lower))
        return "No I am Not";
    if (["yes", "y"].includes(lower))
        return "Yes, I am";
    return "No I am Not";
}
export function normalizeMLSStatus(raw) {
    if (!raw)
        return "FALSE";
    const val = raw.trim().toLowerCase();
    const inactive = ["", "off market", "offmarket", "pa"];
    if (inactive.includes(val))
        return "FALSE";
    return "TRUE";
}
export function normalizeLiquidAssets(raw) {
    if (!raw || raw.trim() === "")
        return undefined;
    const val = raw.trim().toLowerCase();
    if (val === "yes")
        return "Over $20k";
    return undefined;
}
export function normalizeHouseholdIncome(value) {
    if (value === undefined || value === null)
        return undefined;
    let numValue;
    if (typeof value === "string") {
        numValue = Number(value.replace(/[\$,]/g, ""));
    }
    else {
        numValue = value;
    }
    if (numValue < 65000)
        return "Below $65k";
    if (numValue <= 90000)
        return "65k - 90k";
    return "Above 90k";
}
export const normalizeLoanType = (value) => {
    if (!value)
        return undefined;
    const v = value.toString().trim().replace(/\s+/g, " ").toLowerCase();
    if (v === "conventional" ||
        v === "conventional with pmi" ||
        v === "conventional\t" ||
        v === "conventional\t") {
        return "conventional";
    }
    if (v === "arm" ||
        v.includes("adjustable rate mortgage") ||
        v.startsWith("arm")) {
        return "arm";
    }
    if (v === "fha" || v === "fha ") {
        return "fha";
    }
    if (v === "usda") {
        return "usda";
    }
    if (v === "va" ||
        v.includes("veterans") ||
        v.includes("veterans administration") ||
        v.includes("veterans admin")) {
        return "va";
    }
    if (v === "building or construction" ||
        v === "building_or_construction" ||
        v === "construction") {
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
    if (notAvail.has(v))
        return "not_available";
    if (v === "" || v === "0" || v === "none")
        return undefined;
    return undefined;
};
export function normalizedLoanType(raw) {
    if (!raw)
        return undefined;
    const val = raw.trim().toLowerCase();
    if (["conventional", "conventional with pmi", "conventional\t"].includes(val))
        return "Conventional";
    if (["fha", "fha"].includes(val))
        return "FHA";
    if (["va", "veterans administration", "veterans administration"].includes(val))
        return "VA";
    if (["usda"].includes(val))
        return "USDA";
    if (["jumbo"].includes(val))
        return "Jumbo";
    return undefined;
}
export function buildTags(input, existingContactTags, tagToAdd = "Seller") {
    const normalizeSource = (src) => {
        if (!src)
            return [];
        if (Array.isArray(src))
            return src.map((s) => String(s));
        return String(src)
            .split(/[,;\n\r]+/)
            .map((s) => String(s));
    };
    const inputArr = normalizeSource(input).map((s) => s.replace(/\s+/g, " ").trim());
    const existingArr = normalizeSource(existingContactTags).map((s) => s.replace(/\s+/g, " ").trim());
    const map = new Map();
    for (const t of [...existingArr, ...inputArr]) {
        const key = t.trim().toLowerCase();
        if (!key)
            continue;
        if (!map.has(key))
            map.set(key, t);
    }
    const addKey = tagToAdd.trim().toLowerCase();
    if (!map.has(addKey)) {
        map.set(addKey, tagToAdd);
    }
    const result = Array.from(map.values()).map((s) => s.trim());
    return result.length ? result : undefined;
}
export function normalizePropertyType(input) {
    if (!input)
        return null;
    const value = input.trim().toLowerCase();
    const mappings = {
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
export function normalizeLeadSource(value) {
    const options = [
        "Saw Sign",
        "On Zillow",
        "Redfin",
        "Home.com",
        "Facebook Marketplace",
        "Other",
    ];
    if (!value)
        return undefined;
    return options.find((opt) => opt.toLowerCase() === value.toLowerCase());
}
export function normalizeFreeAndClear(value) {
    if (value === undefined || value === null)
        return value; // ← Fixed
    if (typeof value === "boolean") {
        return value ? "TRUE" : "FALSE";
    }
    if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (v === "yes" || v === "true")
            return "TRUE";
        if (v === "no" || v === "false")
            return "FALSE";
    }
    return undefined;
}
export function extractGhlId(respData) {
    if (!respData || typeof respData !== "object")
        return undefined;
    // Helper to safely access nested properties
    const get = (obj, ...keys) => {
        let current = obj;
        for (const key of keys) {
            if (current && typeof current === "object" && key in current) {
                current = current[key];
            }
            else {
                return undefined;
            }
        }
        return current;
    };
    const data = respData;
    return (data.id ||
        get(data, "data", "id") ||
        get(data, "record", "id") ||
        get(data, "data", "record", "id") ||
        get(data, "contact", "id") ||
        undefined);
}
export const parkingMapping = {
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
export async function findGhlContactByEmailOrPhone(email, phone, privateToken, locationId) {
    console.info(`🔍 Searching for existing contact - Email: ${email || "N/A"}, Phone: ${phone || "N/A"}`);
    if (!email && !phone) {
        console.warn(`⚠️ No email or phone provided for contact search`);
        return undefined;
    }
    // ✅ NEW: Normalize email and phone before searching
    const emailNormResult = normalizeEmail(email);
    const phoneNormResult = normalizePhone(phone, "US");
    // Log normalization results for debugging
    if (emailNormResult.warnings.length > 0) {
        console.debug(`📧 Email normalization warnings:`, emailNormResult.warnings);
    }
    if (phoneNormResult.warnings.length > 0) {
        console.debug(`📱 Phone normalization warnings:`, phoneNormResult.warnings);
    }
    // Use normalized values for search
    const normalizedEmail = emailNormResult.normalized;
    const normalizedPhone = phoneNormResult.normalized;
    console.debug(`🔍 Searching with normalized values - Email: ${normalizedEmail || "N/A"}, Phone: ${normalizedPhone || "N/A"}`);
    try {
        const headers = {
            Authorization: `Bearer ${privateToken}`,
            Version: API_VERSION,
            Accept: "application/json",
        };
        // 1️⃣ Try searching by normalized email first (if available and valid)
        if (normalizedEmail && emailNormResult.isValid) {
            console.debug(`📧 Searching GHL by normalized email: ${normalizedEmail}`);
            try {
                const resp = await axios.get(`${GHL_BASE_URL}/contacts/search/duplicate`, {
                    headers,
                    params: {
                        locationId,
                        email: normalizedEmail,
                    },
                });
                const contact = resp.data?.contact || resp.data;
                if (contact?.id) {
                    console.info(`✅ Found contact by email: ${contact.id}`);
                    return contact.id;
                }
            }
            catch (emailError) {
                const axiosError = axios.isAxiosError(emailError) ? emailError : null;
                const status = axiosError?.response?.status;
                if (status === 404) {
                    console.debug(`ℹ️ No contact found by email (404)`);
                }
                else if (status === 422) {
                    console.warn(`⚠️ Email search validation error (422):`, axiosError?.response?.data);
                }
                else {
                    const errorMessage = emailError instanceof Error
                        ? emailError.message
                        : String(emailError);
                    console.error(`❌ Email search failed with status ${status}:`, axiosError?.response?.data || errorMessage);
                    if (status === 401 || status === 403) {
                        throw emailError;
                    }
                }
            }
            // ✅ NEW: If normalized email search failed, try original email as fallback
            if (normalizedEmail !== email && email) {
                console.debug(`🔄 Trying original email as fallback: ${email}`);
                try {
                    const resp = await axios.get(`${GHL_BASE_URL}/contacts/search/duplicate`, {
                        headers,
                        params: {
                            locationId,
                            email: email.trim(),
                        },
                    });
                    const contact = resp.data?.contact || resp.data;
                    if (contact?.id) {
                        console.info(`✅ Found contact by original email: ${contact.id}`);
                        return contact.id;
                    }
                }
                catch {
                    // Ignore fallback errors
                }
            }
        }
        // 2️⃣ Try searching by normalized phone (if email search failed and phone is valid)
        if (normalizedPhone && phoneNormResult.isValid) {
            console.debug(`📱 Searching GHL by normalized phone: ${normalizedPhone}`);
            try {
                const resp = await axios.get(`${GHL_BASE_URL}/contacts/search/duplicate`, {
                    headers,
                    params: {
                        locationId,
                        number: normalizedPhone,
                    },
                });
                const contact = resp.data?.contact || resp.data;
                if (contact?.id) {
                    console.info(`✅ Found contact by phone: ${contact.id}`);
                    return contact.id;
                }
            }
            catch (phoneError) {
                const axiosError = axios.isAxiosError(phoneError) ? phoneError : null;
                const status = axiosError?.response?.status;
                if (status === 404) {
                    console.debug(`ℹ️ No contact found by phone (404)`);
                }
                else if (status === 422) {
                    console.warn(`⚠️ Phone search validation error (422):`, axiosError?.response?.data);
                }
                else {
                    const errorMessage = phoneError instanceof Error
                        ? phoneError.message
                        : String(phoneError);
                    console.error(`❌ Phone search failed with status ${status}:`, axiosError?.response?.data || errorMessage);
                    if (status === 401 || status === 403) {
                        throw phoneError;
                    }
                }
            }
            // ✅ NEW: If normalized phone search failed, try original phone as fallback
            if (normalizedPhone !== phone?.replace(/\D/g, "") && phone) {
                console.debug(`🔄 Trying original phone as fallback: ${phone}`);
                try {
                    const resp = await axios.get(`${GHL_BASE_URL}/contacts/search/duplicate`, {
                        headers,
                        params: {
                            locationId,
                            number: phone.trim(),
                        },
                    });
                    const contact = resp.data?.contact || resp.data;
                    if (contact?.id) {
                        console.info(`✅ Found contact by original phone: ${contact.id}`);
                        return contact.id;
                    }
                }
                catch {
                    // Ignore fallback errors
                }
            }
        }
        console.info(`ℹ️ Contact not found in GHL (this is normal for new contacts)`);
        return undefined;
    }
    catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const axiosError = axios.isAxiosError(e) ? e : null;
        const status = axiosError?.response?.status;
        console.error(`❌ Critical error searching for contact:`, {
            error: errorMsg,
            status,
            email: normalizedEmail || "N/A",
            phone: normalizedPhone || "N/A",
            responseData: axiosError?.response?.data,
        });
        // Re-throw auth errors so the job stops
        if (status === 401 || status === 403) {
            throw e;
        }
        return undefined;
    }
}
export async function findGhlPropertyByAddress(address, privateToken, locationId) {
    if (!address) {
        console.debug(`⚠️ No address provided for property search`);
        return undefined;
    }
    // ✅ NEW: Normalize address before searching
    const addressNormResult = normalizeAddress(address);
    // Log normalization results for debugging
    if (addressNormResult.warnings.length > 0) {
        console.debug(`🏠 Address normalization warnings:`, addressNormResult.warnings);
    }
    const normalizedAddress = addressNormResult.normalized;
    if (!normalizedAddress) {
        console.warn(`⚠️ Address normalization failed: ${address}`);
        // Fall back to original address
    }
    const searchAddress = normalizedAddress || address;
    console.info(`🏠 Searching for existing property: ${searchAddress}`);
    console.debug(`🔍 Original address: ${address}`);
    console.debug(`🔍 Normalized address: ${normalizedAddress}`);
    try {
        const headers = {
            Authorization: `Bearer ${privateToken}`,
            Version: API_VERSION,
            Accept: "application/json",
            "Content-Type": "application/json",
        };
        // ✅ IMPROVED: Try normalized address first
        const resp = await axios.post(`${GHL_BASE_URL}/objects/${CUSTOM_OBJECT_KEY}/records/search`, {
            locationId,
            page: 1,
            pageLimit: 10, // ✅ Get more results for better matching
            query: searchAddress,
        }, {
            headers,
        });
        const records = resp.data?.records || [];
        if (records.length > 0) {
            // ✅ NEW: If we have multiple results, try to find exact match
            for (const record of records) {
                const recordAddress = record.properties?.address;
                if (!recordAddress)
                    continue;
                // Try exact normalized match
                const recordNormalized = normalizeAddress(recordAddress).normalized;
                if (recordNormalized && recordNormalized === normalizedAddress) {
                    console.info(`✅ Found exact match property: ${record.id} (normalized)`);
                    return record.id;
                }
                // ✅ NEW: Try fuzzy match as fallback
                const fuzzy1 = normalizeAddressForFuzzyMatch(address);
                const fuzzy2 = normalizeAddressForFuzzyMatch(recordAddress);
                if (fuzzy1 && fuzzy2 && fuzzy1 === fuzzy2) {
                    console.info(`✅ Found fuzzy match property: ${record.id} (fuzzy match)`);
                    console.debug(`   Original: ${address}`);
                    console.debug(`   Matched: ${recordAddress}`);
                    return record.id;
                }
            }
            // If no exact or fuzzy match, return first result
            console.info(`✅ Found property (first result): ${records[0].id} (no exact match)`);
            console.warn(`⚠️ No exact match found, using first search result. Consider manual verification.`);
            return records[0].id;
        }
        // ✅ NEW: If normalized search failed, try original address as fallback
        if (normalizedAddress !== address && normalizedAddress) {
            console.debug(`🔄 Trying original address as fallback: ${address}`);
            const fallbackResp = await axios.post(`${GHL_BASE_URL}/objects/${CUSTOM_OBJECT_KEY}/records/search`, {
                locationId,
                page: 1,
                pageLimit: 1,
                query: address,
            }, {
                headers,
            });
            const fallbackRecords = fallbackResp.data?.records || [];
            if (fallbackRecords.length > 0 && fallbackRecords[0]?.id) {
                console.info(`✅ Found property using original address: ${fallbackRecords[0].id}`);
                return fallbackRecords[0].id;
            }
        }
        console.debug(`ℹ️ No property found with address: ${searchAddress}`);
        return undefined;
    }
    catch (error) {
        const axiosError = axios.isAxiosError(error) ? error : null;
        const errorInstance = error instanceof Error ? error : null;
        const status = axiosError?.response?.status;
        const errorData = axiosError?.response?.data;
        if (status === 404) {
            console.debug(`ℹ️ No property found (404)`);
        }
        else if (status === 400) {
            console.warn(`⚠️ Bad request searching for property:`, errorData);
        }
        else if (status === 422) {
            console.warn(`⚠️ Validation error searching for property:`, errorData);
        }
        else if (status === 401 || status === 403) {
            console.error(`❌ Authentication error searching for property:`, errorData);
            throw error; // Re-throw auth errors
        }
        else {
            console.error(`❌ Error searching for property:`, {
                status,
                error: errorData || errorInstance?.message || String(error),
                address: searchAddress,
            });
        }
        return undefined;
    }
}
