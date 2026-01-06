import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import Redis from "ioredis";

// Track rate limiter stats
let redisClient: Redis | null = null;
let rateLimiter: RateLimiterRedis | RateLimiterMemory | null = null;
let fallbackLimiter: RateLimiterMemory | null = null;
let isRedisHealthy = false;

/**
 * Create in-memory rate limiter (used as fallback or primary when Redis disabled)
 */
function createMemoryLimiter(): RateLimiterMemory {
  return new RateLimiterMemory({
    keyPrefix: 'ghl-rate-limiter',
    points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) / 1000,
    blockDuration: Math.floor(parseInt(process.env.TIMEOUT || "30000", 10) / 1000),
  });
}

/**
 * Create rate limiter with optional Redis backend
 * Automatically falls back to in-memory if Redis is unavailable
 */
function createRateLimiter(): RateLimiterRedis | RateLimiterMemory {
  // Always create a fallback in-memory limiter
  fallbackLimiter = createMemoryLimiter();

  // Check if Redis-backed rate limiting is enabled
  const useRedis = process.env.RATE_LIMIT_ENABLED === 'true';

  if (!useRedis) {
    console.log('⚠️  Creating in-memory rate limiter (Redis disabled)');
    isRedisHealthy = false;
    return fallbackLimiter;
  }

  console.log('✅ Creating Redis-backed rate limiter (distributed)');

  try {
    // Create Redis client with aggressive timeout for initial connection
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
      maxRetriesPerRequest: 3, // Reduced from default 20 to fail faster
      retryStrategy: (times: number) => {
        if (times > 5) {
          console.log('⚠️  Redis connection failed after 5 attempts, falling back to in-memory');
          isRedisHealthy = false;
          return null; // Stop retrying
        }
        const delay = Math.min(times * 100, 2000);
        console.log(`🔄 Redis retry attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
      lazyConnect: false,
      connectTimeout: 5000, // 5 second connection timeout
      commandTimeout: 3000, // 3 second command timeout
    });

    console.log(`📡 Connecting to Redis at ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`);
    console.log(`🔒 TLS: ${process.env.REDIS_TLS === 'true' ? 'Enabled' : 'Disabled'}`);
    console.log(`🔑 Auth: ${process.env.REDIS_PASSWORD ? 'Password Provided' : 'No Password'}`);

    // Create rate limiter with Redis backend
    const limiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'ghl-rate-limiter',
      points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
      duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) / 1000,
      blockDuration: Math.floor(parseInt(process.env.TIMEOUT || "30000", 10) / 1000),
      // Use in-memory fallback if Redis fails
      insuranceLimiter: fallbackLimiter,
    });

    // Listen for Redis connection events
    redisClient.on('connect', () => {
      console.log('✅ Redis-backed rate limiter connected successfully');
      isRedisHealthy = true;
    });

    redisClient.on('ready', () => {
      isRedisHealthy = true;
    });

    redisClient.on('error', (err) => {
      console.error('❌ Redis connection error:', err.message);
      isRedisHealthy = false;
      // Don't throw - let it fall back to in-memory
    });

    redisClient.on('close', () => {
      console.log('⚠️  Redis connection closed');
      isRedisHealthy = false;
    });

    redisClient.on('end', () => {
      console.log('⚠️  Redis connection ended');
      isRedisHealthy = false;
    });

    return limiter;
  } catch (error) {
    console.error('❌ Failed to create Redis-backed limiter, falling back to in-memory:', error);
    // Clean up failed Redis client
    if (redisClient) {
      redisClient.disconnect();
      redisClient = null;
    }
    isRedisHealthy = false;
    return fallbackLimiter;
  }
}

// Initialize the rate limiter
rateLimiter = createRateLimiter();

// Queue for managing concurrent requests
class RequestQueue {
  private queue: Array<() => void> = [];
  private running = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Use the appropriate limiter
    const limiterToUse = (isRedisHealthy && rateLimiter) ? rateLimiter : fallbackLimiter!;

    // Wait for rate limit
    try {
      await limiterToUse.consume('global', 1);
    } catch (rejRes: unknown) {
      if (rejRes instanceof RateLimiterRes) {
        const msBeforeNext = rejRes.msBeforeNext || 1000;
        console.warn(`⚠️ Rate limited, waiting ${msBeforeNext}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, msBeforeNext));
        // Retry after waiting
        return this.execute(fn);
      }
      // If it's a Redis error, use fallback
      if (rejRes instanceof Error && rejRes.message.includes('Redis')) {
        console.warn('⚠️ Redis error in rate limiter, using fallback');
        isRedisHealthy = false;
        try {
          await fallbackLimiter!.consume('global', 1);
        } catch (fallbackErr) {
          if (fallbackErr instanceof RateLimiterRes) {
            const msBeforeNext = fallbackErr.msBeforeNext || 1000;
            await new Promise(resolve => setTimeout(resolve, msBeforeNext));
            return this.execute(fn);
          }
          throw fallbackErr;
        }
      } else {
        throw rejRes;
      }
    }

    // Wait for concurrency slot
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const requestQueue = new RequestQueue(
  parseInt(process.env.GHL_CONCURRENT_REQUESTS || '5', 10)
);

/**
 * Wrap an async function with rate limiting and concurrency control
 * Automatically falls back to in-memory rate limiting if Redis is unavailable
 */
export async function rateLimitedRequest<T>(fn: () => Promise<T>): Promise<T> {
  return requestQueue.execute(fn);
}

// Cleanup function for graceful shutdown
export async function closeRateLimiter(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

// Export health check function
export function isRateLimiterHealthy(): boolean {
  return isRedisHealthy;
}

export default rateLimiter;