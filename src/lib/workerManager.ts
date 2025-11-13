// src/lib/workerManager.ts
import { getQueueInstance, JOB_TYPES, DeliverLeadsPayload } from "./queue";
import { pushLeadsForUser } from "./pushLeads";
import { PrismaClient, Job } from "@prisma/client";
import { setupMemoryMonitoring } from "./monitoring";

const prisma = new PrismaClient();

export class WorkerManager {
  private workerId: number;
  private isRunning: boolean = false;

  constructor(workerId: number) {
    this.workerId = workerId;
  }

  async start() {
    console.log(`🚀 Worker ${this.workerId} starting...`);
    this.isRunning = true;

    // Setup memory monitoring
    setupMemoryMonitoring(this.workerId);

    const boss = await getQueueInstance();

    // Subscribe to deliver-leads jobs
    await boss.work<DeliverLeadsPayload>(
      JOB_TYPES.DELIVER_LEADS,
      async (jobs) => {
        // Handle both single job and array of jobs
        const jobArray = Array.isArray(jobs) ? jobs : [jobs];
        const job = jobArray[0];

        console.log(`👷 Worker ${this.workerId} processing job ${job.id}`);

        try {
          // Update database job status
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "in_progress",
              startedAt: new Date(),
              attempts: { increment: 1 },
            },
          });

          // Create a synthetic Job object for pushLeadsForUser
          const jobData: Job = {
            id: job.id,
            type: job.name,
            payload: job.data as any,
            status: "in_progress",
            attempts: 0,
            maxAttempts: 3,
            lastError: null,
            createdAt: (job as any).createdon
              ? new Date((job as any).createdon)
              : new Date(), // Use current time as fallback
            startedAt: new Date(),
            finishedAt: null,
            updatedAt: new Date(),
            userId: job.data.userId,
          };

          // Process the job
          await pushLeadsForUser(jobData);

          // Update database job status
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "completed",
              finishedAt: new Date(),
            },
          });

          console.log(`✅ Worker ${this.workerId} completed job ${job.id}`);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            `❌ Worker ${this.workerId} failed job ${job.id}:`,
            errorMessage
          );

          // Update database job status
          await prisma.job
            .update({
              where: { id: job.id },
              data: {
                status: "failed",
                lastError: errorMessage,
              },
            })
            .catch((e) => console.error("Failed to update job status:", e));

          // Re-throw to let pg-boss handle retry
          throw error;
        }
      }
    );

    console.log(`✅ Worker ${this.workerId} is now processing jobs`);
  }

  async stop() {
    console.log(`🛑 Worker ${this.workerId} stopping...`);
    this.isRunning = false;
  }

  getStatus() {
    return {
      workerId: this.workerId,
      isRunning: this.isRunning,
    };
  }
}
