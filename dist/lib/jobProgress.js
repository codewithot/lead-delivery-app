// src/lib/jobProgress.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export async function updateJobProgress(jobId, progress) {
    // Fetch the current job
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
        throw new Error(`Job with id ${jobId} not found`);
    }
    // Safely merge progress into payload
    const currentPayload = job.payload || {};
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
export async function getJobProgress(jobId) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
        return null;
    }
    const payload = job.payload || {};
    return payload.progress || null;
}
// Usage example in worker:
// await updateJobProgress(job.id, {
//   processed: 50,
//   total: 200,
//   status: "processing contacts"
// });
