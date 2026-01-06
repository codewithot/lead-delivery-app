// src/lib/validateEnv.ts
// CRITICAL-4: Environment variable validation at startup

import { createLogger } from "./secureLogger";

const logger = createLogger('EnvValidation');

/**
 * Required environment variables for the application to function.
 * Missing any of these will cause the validation to fail.
 */
const REQUIRED_VARS = [
    'DATABASE_URL',
    'NEXTAUTH_SECRET',
    'GHL_CLIENT_ID',
    'GHL_CLIENT_SECRET',
    'WEBHOOK_SECRET',
] as const;

/**
 * Optional but recommended environment variables.
 * Missing these will log a warning but not fail startup.
 */
const RECOMMENDED_VARS = [
    'NEXT_PUBLIC_APP_URL',
    'SLACK_WEBHOOK_URL',
    'REGION_TZ',
] as const;

export interface ValidationResult {
    isValid: boolean;
    missing: string[];
    warnings: string[];
}

/**
 * Validates that all required environment variables are present.
 * Logs warnings for recommended but missing variables.
 * 
 * @param exitOnFailure - If true, calls process.exit(1) on failure. Default: true
 * @returns ValidationResult with details of any issues
 */
export function validateEnvironment(exitOnFailure = true): ValidationResult {
    const missing = REQUIRED_VARS.filter(key => !process.env[key]);
    const warnings = RECOMMENDED_VARS.filter(key => !process.env[key]);

    if (missing.length > 0) {
        logger.error(`❌ Missing required environment variables: ${missing.join(', ')}`);

        if (exitOnFailure) {
            logger.error('Application cannot start without required environment variables.');
            process.exit(1);
        }

        return { isValid: false, missing, warnings };
    }

    if (warnings.length > 0) {
        logger.warn(`⚠️ Optional environment variables not set: ${warnings.join(', ')}`);
    }

    logger.info('✅ All required environment variables present');

    return { isValid: true, missing: [], warnings };
}

/**
 * Validates environment and throws an error if invalid.
 * Useful for testing or when you want to catch the error.
 */
export function validateEnvironmentOrThrow(): void {
    const result = validateEnvironment(false);

    if (!result.isValid) {
        throw new Error(`Missing required environment variables: ${result.missing.join(', ')}`);
    }
}
