import cron from "node-cron";
import { PrismaClient, type Job } from "@prisma/client";
import { pushLeadsForUser } from "./pushLeads.ts";

const prisma = new PrismaClient();

// Main worker logic as a function
async function runWorker() {
  console.log("⏱  Worker tick:", new Date().toISOString());

  // 1) Fetch up to 5 pending jobs
  const jobs = await prisma.job.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 5,
  });

  for (const job of jobs) {
    // Skip if already reached maxAttempts
    if (job.attempts >= job.maxAttempts) continue;

    // 2) Atomically claim this job
    const updated = await prisma.job.updateMany({
      where: {
        id: job.id,
        status: "pending",
        attempts: job.attempts,
      },
      data: {
        status: "in_progress",
        startedAt: new Date(),
      },
    });

    if (updated.count === 0) continue; // someone else claimed it

    try {
      // 3) Process it
      await pushLeadsForUser(job);

      // 4) Mark success
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "completed", finishedAt: new Date() },
      });
      console.log(`✅ Job ${job.id} completed`);
    } catch (err: any) {
      // 5) On error, increment attempts & decide next status
      const nextAttempts = job.attempts + 1;
      const nextStatus = nextAttempts >= job.maxAttempts ? "failed" : "pending";

      await prisma.job.update({
        where: { id: job.id },
        data: {
          attempts: nextAttempts,
          status: nextStatus,
          lastError: err.message,
        },
      });
      console.error(`❌ Job ${job.id} failed:`, err.message);
    }
  }
}

// Run immediately when script starts
runWorker();

// Schedule to run every minute
// cron.schedule("* * * * *", runWorker);
