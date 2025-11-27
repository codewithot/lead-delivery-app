// src/lib/rateLimiter.ts
import Bottleneck from "bottleneck";

// Create a rate limiter for GHL API calls
const ghlLimiter = new Bottleneck({
  maxConcurrent: parseInt(process.env.GHL_CONCURRENT_REQUESTS || "5", 10),
  minTime: 1000 / parseInt(process.env.GHL_REQUESTS_PER_SECOND || "10", 10),
  reservoir: 100, // Initial tokens
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000, // Refresh every minute
});

// Track rate limiter stats
ghlLimiter.on("failed", async (error, jobInfo) => {
  const status = (error as any).response?.status;
  if (status === 429) {
    // Rate limited - retry after delay
    console.warn(`⚠️ Rate limited, retrying in 60 seconds...`);
    return 60000; // Wait 60 seconds before retry
  }
});

ghlLimiter.on("error", (error) => {
  console.error("❌ Rate limiter error:", error);
});

export async function rateLimitedRequest<T>(fn: () => Promise<T>): Promise<T> {
  return ghlLimiter.schedule(fn);
}