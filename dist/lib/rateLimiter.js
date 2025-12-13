"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimitedRequest = rateLimitedRequest;
// src/lib/rateLimiter.ts
const bottleneck_1 = __importDefault(require("bottleneck"));
// Create a rate limiter for GHL API calls
const ghlLimiter = new bottleneck_1.default({
    maxConcurrent: parseInt(process.env.GHL_CONCURRENT_REQUESTS || "5", 10),
    minTime: 1000 / parseInt(process.env.GHL_REQUESTS_PER_SECOND || "10", 10),
    reservoir: 100, // Initial tokens
    reservoirRefreshAmount: 100,
    reservoirRefreshInterval: 60 * 1000, // Refresh every minute
});
ghlLimiter.on("failed", async (error) => {
    const status = error.response?.status;
    if (status === 429) {
        // Rate limited - retry after delay
        console.warn(`⚠️ Rate limited, retrying in 60 seconds...`);
        return 60000; // Wait 60 seconds before retry
    }
});
ghlLimiter.on("error", (error) => {
    console.error("❌ Rate limiter error:", error);
});
async function rateLimitedRequest(fn) {
    return ghlLimiter.schedule(fn);
}
