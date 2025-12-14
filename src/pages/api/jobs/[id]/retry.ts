// src/pages/api/jobs/[id]/retry.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { PrismaClient } from "@prisma/client";
import { getQueueInstance } from "@/lib/queue";

const prisma = new PrismaClient();

export default async function handler(
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

    const { id } = req.query;

    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Job ID is required" });
    }

    // Fetch the job
    const job = await prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Check ownership
    if (job.userId !== session.user.userId) {
      return res.status(403).json({ error: "Forbidden - not your job" });
    }

    // Can only retry failed jobs
    if (job.status !== "failed") {
      return res.status(400).json({
        error: "Can only retry failed jobs",
        currentStatus: job.status,
      });
    }

    // Reset the job to pending and clear attempts
    const updatedJob = await prisma.job.update({
      where: { id },
      data: {
        status: "pending",
        attempts: 0,
        lastError: null,
        startedAt: null,
        finishedAt: null,
        updatedAt: new Date(),
      },
    });

    // Re-enqueue the job in pg-boss
    const boss = await getQueueInstance();

    // Send the job back to the queue
    const newJobId = await boss.send(job.type, job.payload as object, {
      singletonKey: `retry-${id}-${Date.now()}`,
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 3600,
    });

    console.log(`✅ Job ${id} retried successfully. New job ID: ${newJobId}`);

    return res.status(200).json({
      success: true,
      message: "Job retried successfully",
      job: updatedJob,
      newJobId,
    });
  } catch (error) {
    console.error("Error retrying job:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
