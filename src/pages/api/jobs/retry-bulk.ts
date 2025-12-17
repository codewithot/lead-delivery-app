// src/pages/api/jobs/retry-bulk.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { PrismaClient, Prisma } from "@prisma/client";
import { getQueueInstance } from "@/lib/queue";
import { isAdmin } from "@/lib/adminGuard";
import { withRateLimit } from "@/lib/apiRateLimiter";

const prisma = new PrismaClient();

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);

    if (!session?.user?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobIds } = req.body as { jobIds: string[] };

    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: "jobIds array is required" });
    }

    // Limit bulk operations
    if (jobIds.length > 100) {
      return res.status(400).json({
        error: "Cannot retry more than 100 jobs at once",
      });
    }

    // Fetch all jobs
    const whereCondition: Prisma.JobWhereInput = {
      id: { in: jobIds },
    };

    // Only restrict to userId if not admin
    if (!isAdmin(session)) {
      whereCondition.userId = session.user.userId;
    }

    const jobs = await prisma.job.findMany({
      where: whereCondition,
    });

    if (jobs.length === 0) {
      return res.status(404).json({ error: "No jobs found" });
    }

    // Filter only failed jobs
    const failedJobs = jobs.filter((job) => job.status === "failed");

    if (failedJobs.length === 0) {
      return res.status(400).json({
        error: "None of the specified jobs are in failed status",
      });
    }

    const boss = await getQueueInstance();
    const results = {
      successful: [] as string[],
      failed: [] as { id: string; error: string }[],
    };

    // Process each job
    for (const job of failedJobs) {
      try {
        // Reset job status
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: "pending",
            attempts: 0,
            lastError: null,
            startedAt: null,
            finishedAt: null,
            updatedAt: new Date(),
          },
        });

        // Re-enqueue
        await boss.send(job.type, job.payload as object, {
          singletonKey: `retry-${job.id}-${Date.now()}`,
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: 3600,
        });

        results.successful.push(job.id);
      } catch (error) {
        results.failed.push({
          id: job.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    console.log(
      `✅ Bulk retry completed: ${results.successful.length} successful, ${results.failed.length} failed`
    );

    return res.status(200).json({
      success: true,
      message: `Retried ${results.successful.length} jobs`,
      results,
      summary: {
        requested: jobIds.length,
        found: jobs.length,
        failed: failedJobs.length,
        retried: results.successful.length,
        errors: results.failed.length,
      },
    });
  } catch (error) {
    console.error("Error in bulk retry:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export default withRateLimit(handler, {
  tier: "WRITE",
  getUserId: async (req) => {
    try {
      const session = await getServerSession(req, {} as NextApiResponse, authOptions);
      return session?.user?.userId;
    } catch {
      return undefined;
    }
  },
});
