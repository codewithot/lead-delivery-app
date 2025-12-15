// src/pages/api/plan-usage.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);

    if (!session?.user?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.userId },
      include: { settings: true },
    });

    if (!user?.settings) {
      return res.status(404).json({ error: "User settings not found" });
    }

    const settings = user.settings;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Count properties pushed today
    const pushedToday = await prisma.property.count({
      where: {
        price: {
          gte: settings.priceMin ?? 0,
          lte: settings.priceMax ?? Number.MAX_SAFE_INTEGER,
        },
        postalCode: { in: settings.zipCodes },
        pushed: true,
        pushedAt: {
          gte: today,
        },
      },
    });

    // Count available properties
    const availableCount = await prisma.property.count({
      where: {
        price: {
          gte: settings.priceMin ?? 0,
          lte: settings.priceMax ?? Number.MAX_SAFE_INTEGER,
        },
        postalCode: { in: settings.zipCodes },
        pushed: false,
      },
    });

    const remaining = Math.max(0, settings.planLimit - pushedToday);
    const percentageUsed = Math.round((pushedToday / settings.planLimit) * 100);

    return res.status(200).json({
      planLimit: settings.planLimit,
      pushedToday,
      remaining,
      availableCount,
      percentageUsed,
      canPushMore: remaining > 0,
    });
  } catch (error) {
    console.error("Error fetching plan usage:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
