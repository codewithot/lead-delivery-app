// src/pages/api/test-rate-limit.ts
// Simple endpoint to verify rate limiting works - REMOVE IN PRODUCTION
import { NextApiRequest, NextApiResponse } from "next";
import { withRateLimit } from "@/lib/apiRateLimiter";

async function handler(req: NextApiRequest, res: NextApiResponse) {
    return res.status(200).json({
        success: true,
        message: "Rate limit test endpoint",
        timestamp: new Date().toISOString(),
    });
}

// Using WEBHOOK tier for testing (10 requests/minute)
export default withRateLimit(handler, {
    tier: "WEBHOOK",
});
