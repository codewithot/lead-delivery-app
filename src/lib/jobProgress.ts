// src/lib/jobProgress.ts
import { PrismaClient, Job } from "@prisma/client";

const prisma = new PrismaClient();

export async function updateJobProgress(
  jobId: string,
  progress: {
    processed: number;
    total: number;
    status: string;
  }
) {
  // Fetch the current job
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job) {
    throw new Error(`Job with id ${jobId} not found`);
  }

  // Safely merge progress into payload
  const currentPayload = (job.payload as Record<string, any>) || {};
  const updatedPayload = {
    ...currentPayload,
    progress,
  };

  await prisma.job.update({
    where: { id: jobId },
    data: {
      payload: updatedPayload,
    },
  });
}

// Get job progress
export async function getJobProgress(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job) {
    return null;
  }

  const payload = (job.payload as Record<string, any>) || {};
  return payload.progress || null;
}

// Usage example in worker:
// await updateJobProgress(job.id, {
//   processed: 50,
//   total: 200,
//   status: "processing contacts"
// });
