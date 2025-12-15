// src/lib/normalizers.ts
/**
 * Normalization utilities for duplicate detection
 *
 * These functions standardize data formats to improve duplicate detection
 * accuracy when searching for existing contacts and properties.
 */

// ============================================================================
// EMAIL NORMALIZATION
// ============================================================================

interface EmailNormalizationResult {
  normalized: string | null;
  original: string | null;
  isValid: boolean;
  warnings: string[];
}

/**
 * Normalize email address for duplicate detection
 *
 * Rules:
 * 1. Trim whitespace
 * 2. Convert to lowercase
 * 3. Handle Gmail aliases (remove dots, plus addressing)
 * 4. Validate basic format
 *
 * @example
 * normalizeEmail(" John.Doe+tag@Gmail.com ")
 * // => { normalized: "johndoe@gmail.com", isValid: true }
 */
export function normalizeEmail(
  email: string | null | undefined
): EmailNormalizationResult {
  const warnings: string[] = [];

  // Handle null/undefined
  if (!email) {
    return {
      normalized: null,
      original: null,
      isValid: false,
      warnings: ["Email is null or undefined"],
    };
  }

  const original = email;

  // Step 1: Trim whitespace
  let normalized = email.trim();

  // Step 2: Check for empty string
  if (normalized === "") {
    return {
      normalized: null,
      original,
      isValid: false,
      warnings: ["Email is empty after trimming"],
    };
  }

  // Step 3: Convert to lowercase
  normalized = normalized.toLowerCase();

  // Step 4: Basic validation (contains @ and domain)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) {
    warnings.push("Email format may be invalid");
  }

  // Step 5: Check length (RFC 5321 max is 254 chars)
  if (normalized.length > 254) {
    warnings.push("Email exceeds maximum length (254 characters)");
    return {
      normalized: null,
      original,
      isValid: false,
      warnings,
    };
  }

  // Step 6: Handle Gmail-specific normalization
  // Gmail ignores dots in the local part and anything after +
  if (
    normalized.endsWith("@gmail.com") ||
    normalized.endsWith("@googlemail.com")
  ) {
    const [localPart, domain] = normalized.split("@");

    // Remove dots from local part
    let normalizedLocal = localPart.replace(/\./g, "");

    // Remove plus addressing (everything after +)
    if (normalizedLocal.includes("+")) {
      const plusIndex = normalizedLocal.indexOf("+");
      normalizedLocal = normalizedLocal.substring(0, plusIndex);
      warnings.push("Removed Gmail plus addressing");
    }

    // Normalize googlemail.com to gmail.com
    const normalizedDomain = domain === "googlemail.com" ? "gmail.com" : domain;

    normalized = `${normalizedLocal}@${normalizedDomain}`;
    warnings.push("Applied Gmail normalization rules");
  }

  return {
    normalized,
    original,
    isValid: emailRegex.test(normalized),
    warnings,
  };
}

// ============================================================================
// PHONE NORMALIZATION
// ============================================================================

interface PhoneNormalizationResult {
  normalized: string | null;
  original: string | null;
  isValid: boolean;
  countryCode: string | null;
  warnings: string[];
}

/**
 * Normalize phone number for duplicate detection
 *
 * Rules:
 * 1. Remove all non-digit characters
 * 2. Handle US country code (+1)
 * 3. Validate length (10 digits for US)
 * 4. Preserve international format indicator
 *
 * @example
 * normalizePhone("+1 (555) 123-4567", "US")
 * // => { normalized: "5551234567", countryCode: "1", isValid: true }
 */
export function normalizePhone(
  phone: string | null | undefined,
  defaultCountryCode: string = "US"
): PhoneNormalizationResult {
  const warnings: string[] = [];

  // Handle null/undefined
  if (!phone) {
    return {
      normalized: null,
      original: null,
      isValid: false,
      countryCode: null,
      warnings: ["Phone is null or undefined"],
    };
  }

  const original = phone;

  // Step 1: Trim whitespace
  let normalized = phone.trim();

  // Step 2: Check for empty string
  if (normalized === "") {
    return {
      normalized: null,
      original,
      isValid: false,
      countryCode: null,
      warnings: ["Phone is empty after trimming"],
    };
  }

  // Step 3: Extract extension if present (we'll ignore it for duplicate matching)
  const extensionPatterns = [/\s*ext\.?\s*\d+/i, /\s*x\s*\d+/i, /\s*#\s*\d+/];
  for (const pattern of extensionPatterns) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, "");
      warnings.push("Removed phone extension");
    }
  }

  // Step 4: Remove all non-digit characters
  const digitsOnly = normalized.replace(/\D/g, "");

  // Step 5: Check if we have any digits
  if (digitsOnly.length === 0) {
    return {
      normalized: null,
      original,
      isValid: false,
      countryCode: null,
      warnings: ["No digits found in phone number"],
    };
  }

  // Step 6: Determine country code and normalize
  let finalNumber = digitsOnly;
  let countryCode: string | null = null;

  // Handle US/Canada (country code +1)
  if (defaultCountryCode === "US" || defaultCountryCode === "CA") {
    // If starts with 1 and has 11 digits, remove the leading 1
    if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
      finalNumber = digitsOnly.substring(1);
      countryCode = "1";
      warnings.push("Removed US/Canada country code");
    } else if (digitsOnly.length === 10) {
      // Standard 10-digit US/Canada number
      finalNumber = digitsOnly;
      countryCode = "1";
    } else if (digitsOnly.length < 10) {
      warnings.push(
        `Phone number too short (${digitsOnly.length} digits, expected 10)`
      );
    } else if (digitsOnly.length > 11) {
      warnings.push(`Phone number too long (${digitsOnly.length} digits)`);
    }
  }

  // Step 7: Validate final number
  const isValid =
    defaultCountryCode === "US" || defaultCountryCode === "CA"
      ? finalNumber.length === 10
      : finalNumber.length >= 7; // Minimum international phone length

  if (!isValid && warnings.length === 0) {
    warnings.push("Phone number length validation failed");
  }

  return {
    normalized: finalNumber,
    original,
    isValid,
    countryCode,
    warnings,
  };
}

// ============================================================================
// ADDRESS NORMALIZATION
// ============================================================================

interface AddressNormalizationResult {
  normalized: string | null;
  original: string | null;
  isValid: boolean;
  warnings: string[];
}

/**
 * Normalize physical address for duplicate detection
 *
 * Rules:
 * 1. Trim and normalize whitespace
 * 2. Convert to lowercase
 * 3. Expand common abbreviations
 * 4. Remove punctuation
 * 5. Standardize apartment/unit indicators
 *
 * @example
 * normalizeAddress("123  Main  St., Apt. #5")
 * // => { normalized: "123 main street apartment 5", isValid: true }
 */
export function normalizeAddress(
  address: string | null | undefined
): AddressNormalizationResult {
  const warnings: string[] = [];

  // Handle null/undefined
  if (!address) {
    return {
      normalized: null,
      original: null,
      isValid: false,
      warnings: ["Address is null or undefined"],
    };
  }

  const original = address;

  // Step 1: Trim whitespace
  let normalized = address.trim();

  // Step 2: Check for empty string
  if (normalized === "") {
    return {
      normalized: null,
      original,
      isValid: false,
      warnings: ["Address is empty after trimming"],
    };
  }

  // Step 3: Convert to lowercase
  normalized = normalized.toLowerCase();

  // Step 4: Normalize multiple spaces to single space
  normalized = normalized.replace(/\s+/g, " ");

  // Step 5: Expand common street type abbreviations
  const streetAbbreviations: Record<string, string> = {
    "\\bst\\.?\\b": "street",
    "\\bave\\.?\\b": "avenue",
    "\\bdr\\.?\\b": "drive",
    "\\brd\\.?\\b": "road",
    "\\bln\\.?\\b": "lane",
    "\\bct\\.?\\b": "court",
    "\\bpl\\.?\\b": "place",
    "\\bblvd\\.?\\b": "boulevard",
    "\\bhwy\\.?\\b": "highway",
    "\\bpkwy\\.?\\b": "parkway",
    "\\bcir\\.?\\b": "circle",
    "\\bter\\.?\\b": "terrace",
    "\\bsq\\.?\\b": "square",
    "\\btrl\\.?\\b": "trail",
  };

  for (const [abbrev, full] of Object.entries(streetAbbreviations)) {
    const regex = new RegExp(abbrev, "gi");
    if (regex.test(normalized)) {
      normalized = normalized.replace(regex, full);
      warnings.push(`Expanded abbreviation: ${abbrev} → ${full}`);
    }
  }

  // Step 6: Standardize directional prefixes/suffixes
  const directionals: Record<string, string> = {
    "\\bn\\.?\\b": "north",
    "\\bs\\.?\\b": "south",
    "\\be\\.?\\b": "east",
    "\\bw\\.?\\b": "west",
    "\\bne\\.?\\b": "northeast",
    "\\bnw\\.?\\b": "northwest",
    "\\bse\\.?\\b": "southeast",
    "\\bsw\\.?\\b": "southwest",
  };

  for (const [abbrev, full] of Object.entries(directionals)) {
    const regex = new RegExp(abbrev, "gi");
    if (regex.test(normalized)) {
      normalized = normalized.replace(regex, full);
    }
  }

  // Step 7: Standardize apartment/unit indicators
  const unitPatterns: Record<string, string> = {
    "\\bapt\\.?\\s*#?": "apartment ",
    "\\bunit\\.?\\s*#?": "apartment ",
    "\\bste\\.?\\s*#?": "suite ",
    "\\b#": "apartment ",
  };

  for (const [pattern, replacement] of Object.entries(unitPatterns)) {
    const regex = new RegExp(pattern, "gi");
    if (regex.test(normalized)) {
      normalized = normalized.replace(regex, replacement);
      warnings.push("Standardized unit indicator");
    }
  }

  // Step 8: Remove common punctuation (but preserve hyphens in street names)
  normalized = normalized.replace(/[.,;]/g, "");

  // Step 9: Final whitespace normalization
  normalized = normalized.replace(/\s+/g, " ").trim();

  // Step 10: Basic validation (should have at least a number and a word)
  const hasNumber = /\d/.test(normalized);
  const hasLetter = /[a-z]/.test(normalized);
  const isValid = hasNumber && hasLetter && normalized.length >= 5;

  if (!isValid) {
    warnings.push(
      "Address validation failed (too short or missing components)"
    );
  }

  return {
    normalized,
    original,
    isValid,
    warnings,
  };
}

/**
 * Create a fuzzy-match friendly version of an address
 * More aggressive normalization for loose matching
 *
 * @example
 * normalizeAddressForFuzzyMatch("123 N. Main Street, Apt 5B")
 * // => "123northmainstreet5"
 */
export function normalizeAddressForFuzzyMatch(
  address: string | null | undefined
): string | null {
  const result = normalizeAddress(address);

  if (!result.normalized) {
    return null;
  }

  // Remove all spaces and apartment info for fuzzy matching
  let fuzzy = result.normalized;

  // Remove apartment/suite/unit indicators and their numbers
  fuzzy = fuzzy.replace(/\b(apartment|suite|unit)\s*\d+[a-z]?/gi, "");

  // Remove all remaining spaces
  fuzzy = fuzzy.replace(/\s+/g, "");

  // Remove remaining special characters
  fuzzy = fuzzy.replace(/[^a-z0-9]/g, "");

  return fuzzy;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if two emails match after normalization
 */
export function emailsMatch(
  email1: string | null | undefined,
  email2: string | null | undefined
): boolean {
  const norm1 = normalizeEmail(email1);
  const norm2 = normalizeEmail(email2);

  if (!norm1.normalized || !norm2.normalized) {
    return false;
  }

  return norm1.normalized === norm2.normalized;
}

/**
 * Check if two phone numbers match after normalization
 */
export function phonesMatch(
  phone1: string | null | undefined,
  phone2: string | null | undefined,
  countryCode: string = "US"
): boolean {
  const norm1 = normalizePhone(phone1, countryCode);
  const norm2 = normalizePhone(phone2, countryCode);

  if (!norm1.normalized || !norm2.normalized) {
    return false;
  }

  return norm1.normalized === norm2.normalized;
}

/**
 * Check if two addresses match after normalization
 */
export function addressesMatch(
  address1: string | null | undefined,
  address2: string | null | undefined,
  useFuzzyMatch: boolean = false
): boolean {
  if (useFuzzyMatch) {
    const fuzzy1 = normalizeAddressForFuzzyMatch(address1);
    const fuzzy2 = normalizeAddressForFuzzyMatch(address2);

    if (!fuzzy1 || !fuzzy2) {
      return false;
    }

    return fuzzy1 === fuzzy2;
  }

  const norm1 = normalizeAddress(address1);
  const norm2 = normalizeAddress(address2);

  if (!norm1.normalized || !norm2.normalized) {
    return false;
  }

  return norm1.normalized === norm2.normalized;
}

/**
 * Normalize all contact data for duplicate detection
 */
export function normalizeContactData(contact: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}) {
  return {
    emailNormalized: normalizeEmail(contact.email).normalized,
    phoneNormalized: normalizePhone(contact.phone).normalized,
    firstNameNormalized: contact.firstName?.trim().toLowerCase() || null,
    lastNameNormalized: contact.lastName?.trim().toLowerCase() || null,
  };
}

/**
 * Normalize property data for duplicate detection
 */
export function normalizePropertyData(property: {
  addressFull?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}) {
  // Build full address if not provided
  let fullAddress = property.addressFull;

  if (!fullAddress && property.streetAddress) {
    const parts = [
      property.streetAddress,
      property.city,
      property.state,
      property.postalCode,
    ].filter(Boolean);

    fullAddress = parts.join(", ");
  }

  const addressResult = normalizeAddress(fullAddress);

  return {
    addressNormalized: addressResult.normalized,
    addressFuzzy: normalizeAddressForFuzzyMatch(fullAddress),
    postalCodeNormalized: property.postalCode?.trim().toUpperCase() || null,
  };
}
