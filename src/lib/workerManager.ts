// src/lib/workerManager.ts
import { getQueueInstance, JOB_TYPES, DeliverLeadsBatchPayload } from "./queue";
import { PrismaClient, Job } from "@prisma/client";
import { setupMemoryMonitoring } from "./monitoring";
import { EventEmitter } from "events";

const prisma = new PrismaClient();

interface WorkerMetrics {
  jobsProcessed: number;
  jobsFailed: number;
  totalProcessingTime: number;
  averageProcessingTime: number;
}

export class WorkerManager {
  private workerId: number;
  private isRunning: boolean = false;
  private activeJobs: number = 0;
  private eventEmitter: EventEmitter;
  private metrics = {
    jobsProcessed: 0,
    jobsFailed: 0,
    totalProcessingTime: 0,
  };

  constructor(workerId: number, eventEmitter?: EventEmitter) {
    this.workerId = workerId;
    this.eventEmitter = eventEmitter ?? new EventEmitter();
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

    // Subscribe to deliver-leads-batch jobs
    await boss.work<DeliverLeadsBatchPayload>(
      JOB_TYPES.DELIVER_LEADS_BATCH,
      async (jobs) => {
        const jobArray = Array.isArray(jobs) ? jobs : [jobs];
        const job = jobArray[0];

        this.activeJobs++;
        const startTime = Date.now();

        console.log(
          `👷 Worker ${this.workerId} processing job ${job.id} ` +
            `(Batch ${job.data.batchIndex + 1}/${job.data.totalBatches}) ` +
            `(Active: ${this.activeJobs})`
        );

        try {
          // Try to find existing job or create it if it doesn't exist
          const existingJob = await prisma.job.findUnique({
            where: { id: job.id },
          });

          if (existingJob) {
            await prisma.job.update({
              where: { id: job.id },
              data: {
                status: "in_progress",
                startedAt: new Date(),
                attempts: { increment: 1 },
              },
            });
          } else {
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

          // Process the batch
          await this.processBatch(job.data);

          // Update database job status
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "completed",
              finishedAt: new Date(),
            },
          });

          const processingTime = Date.now() - startTime;
          this.metrics.jobsProcessed++;
          this.metrics.totalProcessingTime += processingTime;

          console.log(
            `✅ Worker ${this.workerId} completed job ${job.id} ` +
              `in ${(processingTime / 1000).toFixed(2)}s`
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            `❌ Worker ${this.workerId} failed job ${job.id}:`,
            errorMessage
          );

          this.metrics.jobsFailed++;

          // Update or create failed job status
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

          throw error;
        } finally {
          this.activeJobs--;

          // Emit event with metrics
          this.eventEmitter.emit("jobCompleted", {
            workerId: this.workerId,
            activeJobs: this.activeJobs,
            metrics: this.getMetrics(),
          });

          console.log(
            `📊 Worker ${this.workerId} - ` +
              `Active: ${this.activeJobs} | ` +
              `Processed: ${this.metrics.jobsProcessed} | ` +
              `Failed: ${this.metrics.jobsFailed} | ` +
              `Avg Time: ${this.getMetrics().averageProcessingTime.toFixed(2)}s`
          );
        }
      }
    );

    console.log(`✅ Worker ${this.workerId} is now processing jobs`);
  }

  private async processBatch(payload: DeliverLeadsBatchPayload) {
    const { userId, batchIndex, batchSize } = payload;

    // Fetch user and settings
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true },
    });

    if (!user?.settings) {
      throw new Error("User or settings not found");
    }

    // Calculate offset for this batch
    const offset = batchIndex * batchSize;

    // Fetch only the properties for this batch
    const properties = await prisma.property.findMany({
      where: {
        price: {
          gte: user.settings.priceMin ?? 0,
          lte: user.settings.priceMax ?? Number.MAX_SAFE_INTEGER,
        },
        postalCode: { in: user.settings.zipCodes },
        pushed: false,
      },
      include: { owner: true },
      skip: offset,
      take: batchSize,
    });

    console.log(
      `📦 Worker ${this.workerId} processing batch ${batchIndex + 1}: ` +
        `${properties.length} properties (offset: ${offset})`
    );

    // Process properties batch
    await this.pushPropertiesBatch(properties, user);
  }

  private async pushPropertiesBatch(properties: any[], user: any) {
    // Import your existing pushLeads logic here
    // This should contain the actual GHL API calls and property processing
    // For now, this is a placeholder that you'll replace with your actual logic

    const { pushLeadsForUser } = await import("./pushLeads");

    // Create a synthetic job object for the batch
    const syntheticJob: Job = {
      id: `batch-${this.workerId}-${Date.now()}`,
      type: JOB_TYPES.DELIVER_LEADS_BATCH,
      payload: { userId: user.id, properties } as any,
      status: "in_progress",
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
      updatedAt: new Date(),
      userId: user.id,
    };

    // Process the properties using your existing logic
    await pushLeadsForUser(syntheticJob);
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

    // Log final metrics
    console.log(
      `📊 Final metrics for Worker ${this.workerId}:`,
      this.getMetrics()
    );
  }

  getStatus() {
    return {
      workerId: this.workerId,
      isRunning: this.isRunning,
      activeJobs: this.activeJobs,
      metrics: this.getMetrics(),
    };
  }

  getMetrics(): WorkerMetrics {
    return {
      jobsProcessed: this.metrics.jobsProcessed,
      jobsFailed: this.metrics.jobsFailed,
      totalProcessingTime: this.metrics.totalProcessingTime,
      averageProcessingTime:
        this.metrics.jobsProcessed > 0
          ? this.metrics.totalProcessingTime / this.metrics.jobsProcessed / 1000
          : 0,
    };
  }

  hasActiveJobs(): boolean {
    return this.activeJobs > 0;
  }

  resetMetrics() {
    this.metrics = {
      jobsProcessed: 0,
      jobsFailed: 0,
      totalProcessingTime: 0,
    };
    console.log(`🔄 Worker ${this.workerId} metrics reset`);
  }
}
