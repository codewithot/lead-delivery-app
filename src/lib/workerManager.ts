// src/lib/workerManager.ts
import { getQueueInstance, JOB_TYPES, DeliverLeadsPayload } from "./queue";
import { pushLeadsForUser } from "./pushLeads";
import { PrismaClient, Job } from "@prisma/client";
import { setupMemoryMonitoring } from "./monitoring";
import { EventEmitter } from "events";

const prisma = new PrismaClient();

export class WorkerManager {
  private workerId: number;
  private isRunning: boolean = false;
  private activeJobs: number = 0;
  private eventEmitter: EventEmitter;

  constructor(workerId: number, eventEmitter?: EventEmitter) {
    this.workerId = workerId;
    this.eventEmitter = eventEmitter ?? new EventEmitter(); // <-- default if not provided
  }

  async start() {
    if (this.isRunning) {
      console.log(`⚠️ Worker ${this.workerId} is already running`);
      return;
    }

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

        this.activeJobs++;
        console.log(
          `👷 Worker ${this.workerId} processing job ${job.id} (Active: ${this.activeJobs})`
        );

        try {
          // Try to find existing job or create it if it doesn't exist
          const existingJob = await prisma.job.findUnique({
            where: { id: job.id },
          });

          if (existingJob) {
            // Update existing job
            await prisma.job.update({
              where: { id: job.id },
              data: {
                status: "in_progress",
                startedAt: new Date(),
                attempts: { increment: 1 },
              },
            });
          } else {
            // Create job record if it doesn't exist
            console.log(`ℹ️  Creating missing job record for ${job.id}`);
            await prisma.job.create({
              data: {
                id: job.id,
                type: job.name,
                payload: job.data as any,
                userId: job.data.userId,
                status: "in_progress",
                startedAt: new Date(),
                attempts: 1,
              },
            });
          }

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
              : new Date(),
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

          // Update or create failed job status using upsert
          await prisma.job
            .upsert({
              where: { id: job.id },
              create: {
                id: job.id,
                type: job.name,
                payload: job.data as any,
                userId: job.data.userId,
                status: "failed",
                lastError: errorMessage,
                attempts: 1,
              },
              update: {
                status: "failed",
                lastError: errorMessage,
              },
            })
            .catch((e) => console.error("Failed to update job status:", e));

          // Re-throw to let pg-boss handle retry
          throw error;
        } finally {
          this.activeJobs--;
          console.log(
            `📊 Worker ${this.workerId} active jobs: ${this.activeJobs}`
          );

          // Emit event when worker completes a job
          this.eventEmitter.emit("jobCompleted", {
            workerId: this.workerId,
            activeJobs: this.activeJobs,
          });
        }
      }
    );

    console.log(`✅ Worker ${this.workerId} is now processing jobs`);
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log(`🛑 Worker ${this.workerId} stopping...`);
    this.isRunning = false;

    // Wait for active jobs to complete (with timeout)
    const timeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.activeJobs > 0 && Date.now() - startTime < timeout) {
      console.log(
        `⏳ Worker ${this.workerId} waiting for ${this.activeJobs} active jobs...`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (this.activeJobs > 0) {
      console.warn(
        `⚠️ Worker ${this.workerId} forced shutdown with ${this.activeJobs} active jobs`
      );
    } else {
      console.log(`✅ Worker ${this.workerId} stopped cleanly`);
    }
  }

  getStatus() {
    return {
      workerId: this.workerId,
      isRunning: this.isRunning,
      activeJobs: this.activeJobs,
    };
  }

  hasActiveJobs(): boolean {
    return this.activeJobs > 0;
  }
}
