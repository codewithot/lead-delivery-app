// src/pages/api/workers/health.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getQueueInstance } from "@/lib/queue";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const boss = await getQueueInstance();

    // Check queue health by getting queue information
    const queues = await boss.getQueues();

    // Query job statistics directly from your database
    const [pendingJobs, activeJobs, completedJobs, failedJobs] =
      await Promise.all([
        prisma.job.count({ where: { status: "pending" } }),
        prisma.job.count({ where: { status: "in_progress" } }),
        prisma.job.count({ where: { status: "completed" } }),
        prisma.job.count({ where: { status: "failed" } }),
      ]);

    const metrics = {
      queueHealth: "healthy",
      activeQueues: queues.length,
      jobStats: {
        pending: pendingJobs,
        active: activeJobs,
        completed: completedJobs,
        failed: failedJobs,
      },
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(metrics);
  } catch (error) {
    return res.status(500).json({
      queueHealth: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
}
