interface CountriesLib {
  registerLocale(locale: any): void;
  isValid(code: string): boolean;
  getAlpha2Code(name: string, lang: string): string | undefined;
  alpha2ToAlpha3(code: string): string;
  getNames(lang: string): Record<string, string>;
}

interface BulkResult {
  map: Record<string, string | null>;
  counts: Record<string, number>;
}

let countriesLib: CountriesLib | null = null;
try {
  // optional, best-effort: use i18n-iso-countries if installed
  // this package improves matching and supports many languages/aliases
  // If you install it, the code will register 'en' locale automatically.
  // NOTE: If you need other locales (fr, es...) register them similarly.
  //   const countries = require("i18n-iso-countries");
  //   countries.registerLocale(require("i18n-iso-countries/langs/en.json"));
  //   ...
  countriesLib = require("i18n-iso-countries");
  try {
    // try to register English locale if not already registered
    // (some environments require explicit registration)
    countriesLib!.registerLocale(require("i18n-iso-countries/langs/en.json"));
  } catch (err) {
    // ignore — may already be registered or not available
  }
} catch (e) {
  countriesLib = null;
}

// Small alpha3 -> alpha2 map for common codes (fallback)
const ALPHA3_TO_ALPHA2: Record<string, string> = {
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
const ALIASES: Record<string, string> = {
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
function _normalizeTextForMatch(
  input: string | number | null | undefined
): string {
  if (!input) return "";
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
export function normalizeCountry(
  value: string | number | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // If already 2-letter code
  const lettersOnly = raw.replace(/[^A-Za-z]/g, "");
  if (lettersOnly.length === 2) {
    const code2 = lettersOnly.toUpperCase();
    // quick sanity: if using countriesLib we can verify; else return uppercase
    if (countriesLib) {
      if (countriesLib.isValid(code2)) return code2;
    } else {
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
          if (alpha3 === code3) return alpha2;
        }
      } catch (e) {
        // ignore
      }
    }
    if (ALPHA3_TO_ALPHA2[code3]) return ALPHA3_TO_ALPHA2[code3];
  }

  // Try countriesLib by name (best option)
  if (countriesLib) {
    // try as-is (English)
    const asName = raw;
    const code = countriesLib.getAlpha2Code(asName, "en");
    if (code) return code;

    // try normalized lower-case name
    const normalized = _normalizeTextForMatch(raw);
    // try several heuristics: Title Case / start-case
    const title = normalized
      .split(" ")
      .map((t) => (t.length ? t[0].toUpperCase() + t.slice(1) : ""))
      .join(" ");
    const code2 = countriesLib.getAlpha2Code(title, "en");
    if (code2) return code2;

    // fallback: loop names to find substring matches (slower but helpful)
    try {
      const names = countriesLib.getNames("en"); // { "US": "United States", ... }
      for (const [alpha2, englishName] of Object.entries(names)) {
        const n1 = englishName.toLowerCase();
        if (
          n1 === normalized ||
          n1.includes(normalized) ||
          normalized.includes(n1)
        ) {
          return alpha2;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // fallback alias map
  const key = _normalizeTextForMatch(raw);
  if (ALIASES[key]) return ALIASES[key];

  // some fuzzy checks: if input includes country code or name as word
  // ex: "United States (USA)" or "USA - United States"
  const keyWords = key.split(/\s+/).filter(Boolean);
  for (const kw of keyWords) {
    if (ALIASES[kw]) return ALIASES[kw];
    // also check alpha3 map
    const up = kw.toUpperCase();
    if (ALPHA3_TO_ALPHA2[up]) return ALPHA3_TO_ALPHA2[up];
    if (up.length === 2) {
      if (countriesLib && countriesLib.isValid(up)) return up;
    }
  }

  // If still unknown, return null
  return null;
}

/**
 * normalizeCountriesBulk(arr)
 * returns an object { original -> normalized } and also counts of normalized values
 */
export function normalizeCountriesBulk(
  values: (string | number | null | undefined)[]
): BulkResult {
  const map: Record<string, string | null> = {};
  const counts: Record<string, number> = {};
  for (const v of values) {
    const normalized = normalizeCountry(v);
    map[String(v)] = normalized;
    if (normalized) counts[normalized] = (counts[normalized] || 0) + 1;
  }
  return { map, counts };
}

export function normalizePostalCode(
  postalCode: string | null | undefined,
  countryCode: string = "US"
): string | null {
  if (!postalCode) return null;

  let pc = postalCode.toString().trim().toUpperCase();

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
      const caMatch = pc.replace(/\s+/g, "").match(/^([A-Z]\d[A-Z])(\d[A-Z]\d)$/);
      if (caMatch) {
        return `${caMatch[1]} ${caMatch[2]}`;
      }
      return null;
    }

    case "GB": {
      // UK formats (very loose)
      const gbMatch = pc.replace(/\s+/g, "").match(/^([A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/);
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
