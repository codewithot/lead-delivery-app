// src/pages/api/admin/users.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "@/lib/adminGuard";
import { withRateLimit } from "@/lib/apiRateLimiter";

const prisma = new PrismaClient();

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

        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
                _count: {
                    select: {
                        jobs: true,
                        sessions: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        return res.status(200).json({ users });
    } catch (error) {
        console.error("Error fetching users:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}

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
