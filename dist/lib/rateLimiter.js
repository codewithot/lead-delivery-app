import Bottleneck from "bottleneck";
/**
 * Create rate limiter with optional Redis backend
 * Uses Redis for distributed rate limiting when RATE_LIMIT_ENABLED=true
 */
function createRateLimiter() {
    // Check if Redis-backed rate limiting is enabled
    const useRedis = process.env.RATE_LIMIT_ENABLED === 'true';
    if (useRedis) {
        console.log('✅ Creating Redis-backed rate limiter (distributed)');
        // Build Redis client options based on your working test script
        const clientOptions = {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            retryStrategy: (times) => {
                const delay = Math.min(times * 100, 2000);
                console.log(`🔄 Redis retry attempt ${times}, waiting ${delay}ms`);
                return delay;
            },
        };
        // Add password if provided (production has it, local doesn't)
        if (process.env.REDIS_PASSWORD) {
            clientOptions.password = process.env.REDIS_PASSWORD;
        }
        // ⚠️ IMPORTANT: Only add tls if explicitly enabled
        // Your test showed tls: undefined works, so we omit it when false
        // This matches your working test configuration
        if (process.env.REDIS_TLS === 'true') {
            clientOptions.tls = {};
        }
        console.log(`📡 Connecting to Redis at ${clientOptions.host}:${clientOptions.port}`);
        console.log(`🔒 TLS: ${clientOptions.tls ? 'Enabled' : 'Disabled'}`);
        console.log(`🔑 Auth: ${clientOptions.password ? 'Password Provided' : 'No Password'}`);
        try {
            const limiter = new Bottleneck({
                // Redis datastore configuration
                datastore: 'ioredis',
                clientOptions,
                // Shared ID for distributed rate limiting across all workers
                id: 'ghl-rate-limiter',
                // Rate limit configuration (same as before)
                maxConcurrent: parseInt(process.env.GHL_CONCURRENT_REQUESTS || '5', 10),
                minTime: 1000 / parseInt(process.env.GHL_REQUESTS_PER_SECOND || '10', 10),
                reservoir: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
                reservoirRefreshAmount: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
                reservoirRefreshInterval: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
                // Timeout settings
                timeout: 30000, // 30 second timeout for queued jobs
            });
            console.log('✅ Redis-backed rate limiter created successfully');
            return limiter;
        }
        catch (error) {
            console.error('❌ Failed to create Redis-backed limiter, falling back to in-memory:', error);
            // Fall through to create in-memory limiter
        }
    }
    // In-memory rate limiter (fallback or when Redis is disabled)
    console.log('⚠️  Creating in-memory rate limiter (not distributed)');
    return new Bottleneck({
        maxConcurrent: parseInt(process.env.GHL_CONCURRENT_REQUESTS || '5', 10),
        minTime: 1000 / parseInt(process.env.GHL_REQUESTS_PER_SECOND || '10', 10),
        reservoir: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
        reservoirRefreshAmount: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
        reservoirRefreshInterval: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    });
}
// Create the global rate limiter instance
const ghlLimiter = createRateLimiter();
// Event handlers
ghlLimiter.on("failed", async (error) => {
    const status = error.response?.status;
    if (status === 429) {
        // Rate limited - retry after delay
        console.warn(`⚠️ Rate limited, retrying in 60 seconds...`);
        return 60000; // Wait 60 seconds before retry
    }
    // Don't retry for other errors
    return undefined;
});
ghlLimiter.on("error", (error) => {
    console.error("❌ Rate limiter error:", error);
});
// Optional: Log when jobs complete (helpful for debugging)
if (process.env.NODE_ENV === 'development') {
    ghlLimiter.on("done", (info) => {
        console.log(`✅ Job completed | Retry count: ${info.retryCount}`);
    });
}
/**
 * Wrap an async function with rate limiting
 * Same API as before - your existing code doesn't need to change
 */
export async function rateLimitedRequest(fn) {
    return ghlLimiter.schedule(fn);
}
export default ghlLimiter;
