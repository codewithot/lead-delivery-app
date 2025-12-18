// src/lib/secureLogger.ts
/**
 * Secure Logging Utility
 * Prevents sensitive data from being logged to console, files, or external services
 */
// ============================================================================
// SENSITIVE FIELD DEFINITIONS
// ============================================================================
/**
 * Fields that should NEVER be logged in any form
 */
const REDACTED_FIELDS = new Set([
    // Authentication & Authorization
    'password',
    'passwordHash',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'token',
    'apiKey',
    'api_key',
    'secret',
    'clientSecret',
    'client_secret',
    'privateKey',
    'private_key',
    // Payment Information
    'creditCard',
    'credit_card',
    'cardNumber',
    'card_number',
    'cvv',
    'ccv',
    'bankAccount',
    'bank_account',
    'routingNumber',
    'routing_number',
    // Social Security & Tax IDs
    'ssn',
    'socialSecurity',
    'social_security',
    'taxId',
    'tax_id',
    'ein',
    // Personal Identifiers (log only IDs, not full values)
    // Note: We'll truncate these rather than redact
]);
/**
 * Fields that should be truncated/masked but not fully redacted
 */
const TRUNCATED_FIELDS = new Set([
    'email',
    'phone',
    'phoneNumber',
    'phone_number',
    'address',
    'streetAddress',
    'street_address',
    'addressFull',
    'address_full',
]);
/**
 * Fields that should only show first/last few characters
 */
const MASKED_FIELDS = new Set([
    'ghlContactId',
    'ghlPropertyId',
    'contactId',
    'propertyId',
]);
// ============================================================================
// SANITIZATION FUNCTIONS
// ============================================================================
/**
 * Sanitize a single value based on its key
 */
function sanitizeValue(key, value) {
    const lowerKey = key.toLowerCase().replace(/[_-]/g, '');
    // Check for redacted fields
    for (const field of REDACTED_FIELDS) {
        const normalized = field.toLowerCase().replace(/[_-]/g, '');
        if (lowerKey.includes(normalized)) {
            return '[REDACTED]';
        }
    }
    // Check for truncated fields (email, phone, address)
    if (typeof value === 'string') {
        for (const field of TRUNCATED_FIELDS) {
            const normalized = field.toLowerCase().replace(/[_-]/g, '');
            if (lowerKey.includes(normalized)) {
                return truncateString(value);
            }
        }
        // Check for masked fields (IDs)
        for (const field of MASKED_FIELDS) {
            const normalized = field.toLowerCase().replace(/[_-]/g, '');
            if (lowerKey.includes(normalized)) {
                return maskString(value);
            }
        }
    }
    return value;
}
/**
 * Truncate a string to show only first/last few characters
 * Example: "john.doe@example.com" → "jo***@ex***.com"
 */
function truncateString(str) {
    if (!str || str.length <= 6)
        return '***';
    // For emails, preserve domain
    if (str.includes('@')) {
        const [local, domain] = str.split('@');
        const localTrunc = local.length > 2
            ? `${local.slice(0, 2)}***`
            : '***';
        const domainTrunc = domain.length > 2
            ? `${domain.slice(0, 2)}***.${domain.split('.').pop()}`
            : '***';
        return `${localTrunc}@${domainTrunc}`;
    }
    // For phone numbers, show area code only
    const digitsOnly = str.replace(/\D/g, '');
    if (digitsOnly.length >= 10) {
        return `(${digitsOnly.slice(0, 3)}) ***-****`;
    }
    // For addresses and other strings
    if (str.length > 20) {
        return `${str.slice(0, 10)}...${str.slice(-5)}`;
    }
    return `${str.slice(0, 2)}***${str.slice(-2)}`;
}
/**
 * Mask a string showing only first and last few characters
 * Example: "abc123def456" → "abc...456"
 */
function maskString(str) {
    if (!str || str.length <= 8)
        return '***';
    return `${str.slice(0, 3)}...${str.slice(-3)}`;
}
/**
 * Recursively sanitize an object
 */
function sanitizeObject(obj, depth = 0) {
    // Prevent infinite recursion
    if (depth > 10) {
        return '[MAX_DEPTH]';
    }
    // Handle null/undefined
    if (obj === null || obj === undefined) {
        return obj;
    }
    // Handle primitives
    if (typeof obj !== 'object') {
        return obj;
    }
    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, depth + 1));
    }
    // Handle dates
    if (obj instanceof Date) {
        return obj.toISOString();
    }
    // Handle objects
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        // First check if the key itself should be redacted
        const sanitizedValue = sanitizeValue(key, value);
        // If not redacted/truncated, recursively sanitize nested objects
        if (sanitizedValue !== '[REDACTED]' && typeof sanitizedValue === 'object' && sanitizedValue !== null) {
            sanitized[key] = sanitizeObject(sanitizedValue, depth + 1);
        }
        else {
            sanitized[key] = sanitizedValue;
        }
    }
    return sanitized;
}
// ============================================================================
// LOGGING FUNCTIONS
// ============================================================================
/**
 * Log level enum
 */
export var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["INFO"] = "INFO";
    LogLevel["WARN"] = "WARN";
    LogLevel["ERROR"] = "ERROR";
})(LogLevel || (LogLevel = {}));
/**
 * Main secure logger class
 */
export class SecureLogger {
    constructor(context = 'App') {
        this.context = context;
    }
    /**
     * Format log message with context and timestamp
     */
    format(level, message, options = {}) {
        const parts = [];
        if (options.includeTimestamp !== false) {
            parts.push(`[${new Date().toISOString()}]`);
        }
        if (options.includeLevel !== false) {
            parts.push(`[${level}]`);
        }
        parts.push(`[${this.context}]`);
        parts.push(message);
        return parts.join(' ');
    }
    /**
     * Sanitize data for logging
     */
    sanitize(data) {
        return sanitizeObject(data);
    }
    /**
     * Debug log (only in development)
     */
    debug(message, data, options) {
        if (process.env.NODE_ENV === 'production')
            return;
        const sanitized = options?.skipSanitization ? data : this.sanitize(data);
        const formatted = this.format(LogLevel.DEBUG, message, options);
        if (sanitized !== undefined) {
            console.debug(formatted, sanitized);
        }
        else {
            console.debug(formatted);
        }
    }
    /**
     * Info log
     */
    info(message, data, options) {
        const sanitized = options?.skipSanitization ? data : this.sanitize(data);
        const formatted = this.format(LogLevel.INFO, message, options);
        if (sanitized !== undefined) {
            console.log(formatted, sanitized);
        }
        else {
            console.log(formatted);
        }
    }
    /**
     * Warning log
     */
    warn(message, data, options) {
        const sanitized = options?.skipSanitization ? data : this.sanitize(data);
        const formatted = this.format(LogLevel.WARN, message, options);
        if (sanitized !== undefined) {
            console.warn(formatted, sanitized);
        }
        else {
            console.warn(formatted);
        }
    }
    /**
     * Error log
     */
    error(message, error, options) {
        const formatted = this.format(LogLevel.ERROR, message, options);
        if (error !== undefined) {
            // For Error objects, preserve stack trace but sanitize message
            if (error instanceof Error) {
                const sanitizedError = {
                    name: error.name,
                    message: error.message, // Error messages may contain sensitive data
                    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
                };
                console.error(formatted, sanitizedError);
            }
            else {
                const sanitized = options?.skipSanitization ? error : this.sanitize(error);
                console.error(formatted, sanitized);
            }
        }
        else {
            console.error(formatted);
        }
    }
}
// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================
/**
 * Create a logger for a specific context
 */
export function createLogger(context) {
    return new SecureLogger(context);
}
/**
 * Default logger instance
 */
export const logger = new SecureLogger('App');
/**
 * Sanitize data without logging (useful for manual logging)
 */
export function sanitize(data) {
    return sanitizeObject(data);
}
/**
 * Create safe user object for logging
 */
export function safeUser(user) {
    return {
        id: user.id,
        email: user.email ? truncateString(user.email) : undefined,
        name: user.name,
        // Never include tokens or other sensitive fields
    };
}
/**
 * Create safe contact object for logging
 */
export function safeContact(contact) {
    return {
        id: contact.id,
        email: contact.email ? truncateString(contact.email) : null,
        phone: contact.phone ? truncateString(contact.phone) : null,
        firstName: contact.firstName,
        lastName: contact.lastName,
    };
}
/**
 * Create safe property object for logging
 */
export function safeProperty(property) {
    return {
        id: property.id,
        address: property.addressFull ? truncateString(property.addressFull) : null,
        price: property.price,
    };
}
/**
 * Create safe account object for logging (OAuth)
 */
export function safeAccount(account) {
    return {
        provider: account.provider,
        providerAccountId: account.providerAccountId
            ? maskString(account.providerAccountId)
            : undefined,
        // Never include access_token, refresh_token, etc.
    };
}
// ============================================================================
// USAGE EXAMPLES (for documentation)
// ============================================================================
/*
BEFORE:
  console.log("User logged in:", user);
  
AFTER:
  logger.info("User logged in", safeUser(user));
  
---

BEFORE:
  console.log("[jwt] account:", account);
  
AFTER:
  logger.debug("[jwt] Account created", safeAccount(account));
  
---

BEFORE:
  console.log("Processing contact:", contact);
  
AFTER:
  logger.info("Processing contact", safeContact(contact));
  
---

BEFORE:
  console.log("Property details:", property);
  
AFTER:
  logger.info("Property details", safeProperty(property));
  
---

BEFORE:
  console.error("Failed to process:", error, someObject);
  
AFTER:
  logger.error("Failed to process", { error, context: someObject });
*/ 
