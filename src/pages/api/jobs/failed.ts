// src/pages/api/jobs/failed.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { PrismaClient, Prisma } from "@prisma/client";

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

    // Get filter parameters
    const { limit = "50", offset = "0", userId } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    // Build where clause with proper Prisma type
    const whereClause: Prisma.JobWhereInput = {
      status: "failed",
    };

    // If specific userId requested (admin feature)
    if (userId) {
      whereClause.userId = userId as string;
    } else {
      // Regular users only see their own failed jobs
      whereClause.userId = session.user.userId;
    }

    // Fetch failed jobs
    const failedJobs = await prisma.job.findMany({
      where: whereClause,
      include: {
        User: {
          select: {
            email: true,
            name: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: parsedLimit,
      skip: parsedOffset,
    });

    // Get total count for pagination
    const totalCount = await prisma.job.count({
      where: whereClause,
    });

    return res.status(200).json({
      jobs: failedJobs,
      pagination: {
        total: totalCount,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + parsedLimit < totalCount,
      },
    });
  } catch (error) {
    console.error("Error fetching failed jobs:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
