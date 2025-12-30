// src/pages/api/jobs.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { PrismaClient } from "@prisma/client";
import { getJobProgress } from "@/lib/jobProgress";
import { withRateLimit } from "@/lib/apiRateLimiter";
import { createLogger } from "@/lib/secureLogger";

const logger = createLogger('JobsAPI');

const prisma = new PrismaClient();

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);

    const userId = session?.user?.userId;

    if (!userId) {
      logger.warn("Missing userId in session");
      return res.status(401).json({ error: "Unauthorized - missing userId" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      logger.warn("User not found for ID", { userId });
      return res.status(404).json({ error: "User not found" });
    }

    const jobs = await prisma.job.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    const jobsWithProgress = await Promise.all(
      jobs.map(async (job) => {
        const progress = await getJobProgress(job.id);
        return {
          ...job,
          progress: progress || null,
        };
      })
    );

    logger.info(`Found ${jobsWithProgress.length} jobs`, { userId });
    return res.status(200).json(jobsWithProgress);
  } catch (error) {
    logger.error("Error fetching jobs", { error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

// ✅ Wrap with rate limiting - READ tier: 100 requests/minute
export default withRateLimit(handler, {
  tier: 'READ',
  getUserId: async (req) => {
    try {
      const session = await getServerSession(req, {} as NextApiResponse, authOptions);
      return session?.user?.userId;
    } catch {
      return undefined;
    }
  },
});
