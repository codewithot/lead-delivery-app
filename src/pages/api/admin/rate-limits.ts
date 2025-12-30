// src/pages/api/admin/rate-limits.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import {
    getRemainingPoints,
    RATE_LIMIT_TIERS,
    withRateLimit,
} from "@/lib/apiRateLimiter";
import { requireAdmin } from "@/lib/adminGuard";
import { createLogger } from "@/lib/secureLogger";

const logger = createLogger('AdminRateLimits');

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const session = await getServerSession(req, res, authOptions);

        // Verify admin access
        if (!requireAdmin(req, res, session)) {
            return;
        }

        // Default to current user if no userId provided (though admin typically provides one)
        let targetUserId = session?.user?.userId;
        const requestedUserId = req.query.userId as string;

        if (requestedUserId) {
            targetUserId = requestedUserId;
        }

        if (!targetUserId) {
            return res.status(400).json({ error: "User ID required" });
        }

        const userIdKey = `user:${targetUserId}`;

        // Get remaining points for all tiers
        const limits = await Promise.all(
            Object.keys(RATE_LIMIT_TIERS).map(async (tier) => {
                const tierKey = tier as keyof typeof RATE_LIMIT_TIERS;
                const remaining = await getRemainingPoints(userIdKey, tierKey);

                return {
                    tier,
                    config: RATE_LIMIT_TIERS[tierKey],
                    remaining,
                };
            })
        );

        return res.status(200).json({
            userId: targetUserId,
            limits,
        });
    } catch (error) {
        logger.error("Error fetching rate limits", { error });
        return res.status(500).json({ error: "Internal server error" });
    }
}

// Protect the admin endpoint itself with rate limiting (READ tier)
export default withRateLimit(handler, {
    tier: "READ",
    getUserId: async (req) => {
        try {
            const session = await getServerSession(req, {} as NextApiResponse, authOptions);
            return session?.user?.userId;
        } catch {
            return undefined;
        }
    },
});
