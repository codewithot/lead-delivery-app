// src/lib/apiRateLimiter.ts
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import Redis from "ioredis";
// Define rate limit tiers
export const RATE_LIMIT_TIERS = {
    // Strictest - for webhooks and write operations
    WEBHOOK: {
        points: 10, // 10 requests
        duration: 60, // per minute
        blockDuration: 300, // block for 5 minutes
    },
    // Medium - for authenticated write operations
    WRITE: {
        points: 30, // 30 requests
        duration: 60, // per minute
        blockDuration: 60, // block for 1 minute
    },
    // Lenient - for read operations
    READ: {
        points: 100, // 100 requests
        duration: 60, // per minute
        blockDuration: 0, // no blocking for reads
    },
    // Authentication endpoints
    AUTH: {
        points: 5, // 5 requests
        duration: 300, // per 5 minutes
        blockDuration: 900, // block for 15 minutes
    },
};
// ============================================================================
// RATE LIMITER INSTANCES
// ============================================================================
let redisClient = null;
const rateLimiters = new Map();
// Initialize Redis if available (for production)
function getRedisClient() {
    // Use REDIS_HOST or REDIS_URL as our indicators
    if ((process.env.REDIS_HOST || process.env.REDIS_URL) && !redisClient) {
        try {
            const redisOptions = {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379', 10),
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
                retryStrategy: (times) => {
                    if (times > 3) {
                        console.warn("⚠️ Redis API limiter: Failed 3 attempts, falling back to memory");
                        return null;
                    }
                    return Math.min(times * 100, 2000);
                },
            };
            if (process.env.REDIS_PASSWORD) {
                redisOptions.password = process.env.REDIS_PASSWORD;
            }
            // Exact TLS configuration that worked in your test
            if (process.env.REDIS_TLS === 'true') {
                redisOptions.tls = { rejectUnauthorized: false };
            }
            console.log(`📡 Connecting Redis API limiter to ${redisOptions.host}...`);
            redisClient = new Redis(redisOptions);
            redisClient.on("error", (err) => {
                console.error("❌ Redis API rate limiter error:", err.message);
            });
            console.log("✅ Redis API rate limiter connected");
        }
        catch (err) {
            console.warn("⚠️ Redis host config invalid, using in-memory rate limiter", err);
            redisClient = null;
        }
    }
    return redisClient;
}
// Get or create rate limiter instance
function getRateLimiter(tier) {
    const existing = rateLimiters.get(tier);
    if (existing)
        return existing;
    const config = RATE_LIMIT_TIERS[tier];
    const redis = getRedisClient();
    let limiter;
    if (redis) {
        // Use Redis in production
        limiter = new RateLimiterRedis({
            storeClient: redis,
            keyPrefix: `rate_limit:${tier}`,
            points: config.points,
            duration: config.duration,
            blockDuration: config.blockDuration,
            execEvenly: false,
            insuranceLimiter: new RateLimiterMemory({
                points: config.points,
                duration: config.duration,
            }),
        });
    }
    else {
        // Use in-memory for development
        limiter = new RateLimiterMemory({
            points: config.points,
            duration: config.duration,
            blockDuration: config.blockDuration,
        });
    }
    rateLimiters.set(tier, limiter);
    return limiter;
}
// ============================================================================
// IDENTIFIER EXTRACTION
// ============================================================================
/**
 * Get identifier for rate limiting
 * Priority: userId > IP address
 */
function getIdentifier(req, userId) {
    // Use userId if authenticated (better for tracking)
    if (userId) {
        return `user:${userId}`;
    }
    // Fall back to IP address
    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded
        ? Array.isArray(forwarded)
            ? forwarded[0]
            : forwarded.split(",")[0]
        : req.socket.remoteAddress || "unknown";
    return `ip:${ip}`;
}
/**
 * Rate limiting middleware for Next.js API routes
 *
 * @example
 * ```typescript
 * export default withRateLimit(handler, {
 *   tier: 'WRITE',
 *   getUserId: async (req) => {
 *     const session = await getServerSession(req, res, authOptions);
 *     return session?.user?.userId;
 *   }
 * });
 * ```
 */
export function withRateLimit(handler, options) {
    return async (req, res) => {
        const config = RATE_LIMIT_TIERS[options.tier];
        try {
            // Get user ID if function provided
            const userId = options.getUserId
                ? await options.getUserId(req)
                : undefined;
            // Get identifier
            const identifier = getIdentifier(req, userId);
            // Get rate limiter for this tier
            const limiter = getRateLimiter(options.tier);
            // Try to consume a point
            const result = await limiter.consume(identifier, 1);
            // Add rate limit headers
            res.setHeader("X-RateLimit-Limit", config.points.toString());
            res.setHeader("X-RateLimit-Remaining", result.remainingPoints.toString());
            res.setHeader("X-RateLimit-Reset", new Date(Date.now() + result.msBeforeNext).toISOString());
            // Execute handler
            await handler(req, res);
        }
        catch (error) {
            // Rate limit exceeded - rate-limiter-flexible throws RateLimiterRes (not Error)
            const rateLimitError = error;
            if (rateLimitError && typeof rateLimitError.msBeforeNext === "number") {
                const retryAfter = Math.ceil(rateLimitError.msBeforeNext / 1000);
                res.setHeader("Retry-After", retryAfter.toString());
                res.setHeader("X-RateLimit-Limit", config.points.toString());
                res.setHeader("X-RateLimit-Remaining", "0");
                res.setHeader("X-RateLimit-Reset", new Date(Date.now() + rateLimitError.msBeforeNext).toISOString());
                console.warn(`🚨 Rate limit exceeded for ${getIdentifier(req, undefined)}`);
                return res.status(429).json({
                    error: "Too many requests",
                    message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
                    retryAfter,
                });
            }
            // Other error - log and continue (fail open)
            console.error("❌ Rate limiter error:", error);
            await handler(req, res);
        }
    };
}
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
/**
 * Manually consume points (useful for batch operations)
 */
export async function consumePoints(identifier, points, tier = "WRITE") {
    try {
        const limiter = getRateLimiter(tier);
        await limiter.consume(identifier, points);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check remaining points without consuming
 */
export async function getRemainingPoints(identifier, tier = "WRITE") {
    try {
        const limiter = getRateLimiter(tier);
        const result = await limiter.get(identifier);
        return result ? result.remainingPoints : RATE_LIMIT_TIERS[tier].points;
    }
    catch {
        return 0;
    }
}
/**
 * Reset rate limit for an identifier
 */
export async function resetRateLimit(identifier, tier = "WRITE") {
    try {
        const limiter = getRateLimiter(tier);
        await limiter.delete(identifier);
        console.log(`✅ Rate limit reset for ${identifier}`);
    }
    catch (error) {
        console.error("❌ Failed to reset rate limit:", error);
    }
}
// ============================================================================
// CLEANUP
// ============================================================================
/**
 * Close Redis connection on shutdown
 */
export async function closeRateLimiter() {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
        console.log("✅ Redis rate limiter disconnected");
    }
}
