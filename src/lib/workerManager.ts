// src/lib/workerManager.ts - WITH ALERT INTEGRATION
import {
  getQueueInstance,
  JOB_TYPES,
  DeliverLeadsBatchPayload,
  DailyLeadAssignmentPayload,
  getTodayQueueName,
} from "./queue";
import {
  PrismaClient,
  Job,
  Prisma,
  Property,
  User,
  Contact,
  UserSettings,
} from "@prisma/client";
import { setupMemoryMonitoring } from "./monitoring";
import { EventEmitter } from "events";
import { updateJobProgress } from "./jobProgress";
import {
  checkAndClaimIdempotency,
  markIdempotencyCompleted,
  markIdempotencyFailed,
} from "./idempotency";
import { pushLeadsForUser } from "./pushLeads";
import { sendJobFailureAlert } from "./alerts"; // ← NEW: Alert system import

import * as PgBoss from "pg-boss";

const prisma = new PrismaClient();

interface WorkerMetrics {
  jobsProcessed: number;
  jobsFailed: number;
  totalProcessingTime: number;
  averageProcessingTime: number;
}

interface WorkerConfig {
  workerId: number;
  queueName?: string;
  useDailyQueue?: boolean;
  concurrency?: number;
}

export class WorkerManager {
  private workerId: number;
  private isRunning: boolean = false;
  private activeJobs: number = 0;
  private eventEmitter: EventEmitter;
  private queueName?: string;
  private useDailyQueue: boolean;
  private concurrency: number;
  private metrics = {
    jobsProcessed: 0,
    jobsFailed: 0,
    totalProcessingTime: 0,
  };

  constructor(config: WorkerConfig, eventEmitter?: EventEmitter) {
    this.workerId = config.workerId;
    this.queueName = config.queueName;
    this.useDailyQueue = config.useDailyQueue ?? false;
    this.concurrency =
      config.concurrency ?? parseInt(process.env.JOB_CONCURRENCY || "10", 10);
    this.eventEmitter = eventEmitter ?? new EventEmitter();
  }

  async start() {
    if (this.isRunning) {
      console.log(`⚠️ Worker ${this.workerId} is already running`);
      return;
    }

    console.log(`🚀 Worker ${this.workerId} starting...`);

    const targetQueue = this.useDailyQueue
      ? getTodayQueueName()
      : this.queueName;

    if (targetQueue) {
      console.log(`   📍 Binding to queue: ${targetQueue}`);
    } else {
      console.log(`   📍 Binding to all queues`);
    }

    console.log(`   🔢 Concurrency: ${this.concurrency}`);

    this.isRunning = true;

    setupMemoryMonitoring(this.workerId);

    const boss = await getQueueInstance();

    await boss.work<DeliverLeadsBatchPayload>(
      JOB_TYPES.DELIVER_LEADS_BATCH,
      async (jobs) => {
        const jobArray = Array.isArray(jobs) ? jobs : [jobs];
        const job = jobArray[0];
        await this.processBatchJob(job);
      }
    );

    if (this.useDailyQueue || targetQueue) {
      const queueToSubscribe = targetQueue || getTodayQueueName();

      await boss.work<DailyLeadAssignmentPayload>(
        queueToSubscribe,
        async (jobs) => {
          const jobArray = Array.isArray(jobs) ? jobs : [jobs];
          const job = jobArray[0];
          await this.processDailyLeadJob(job);
        }
      );

      console.log(
        `✅ Worker ${this.workerId} subscribed to: ${queueToSubscribe}`
      );
    }

    console.log(
      `ℹ️  Worker ${this.workerId} using default pg-boss concurrency`
    );
    console.log(`   Concurrency is controlled by total number of workers`);
    console.log(`✅ Worker ${this.workerId} is now processing jobs`);
  }

  private async processDailyLeadJob(
    job: PgBoss.Job<DailyLeadAssignmentPayload>
  ) {
    this.activeJobs++;
    const startTime = Date.now();
    const payload: DailyLeadAssignmentPayload = job.data;

    console.log(
      `👷 Worker ${this.workerId} processing daily lead job ${job.id} ` +
        `(Contact: ${payload.contactId}, Properties: ${payload.propertyIds.length}) ` +
        `(Active: ${this.activeJobs})`
    );

    try {
      const queueName = this.useDailyQueue ? getTodayQueueName() : job.name;
      const idempotencyCheck = await checkAndClaimIdempotency(
        queueName,
        payload.idempotencyKey,
        job.id
      );

      if (!idempotencyCheck.shouldProcess) {
        console.log(
          `⏩ Skipping job ${job.id} - already processed (idempotency)`
        );
        return;
      }

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
        await prisma.job.create({
          data: {
            id: job.id,
            type: job.name,
            payload: job.data as unknown as Prisma.InputJsonValue,
            userId: payload.userId,
            status: "in_progress",
            startedAt: new Date(),
            attempts: 1,
          },
        });
      }

      const contact = await prisma.contact.findUnique({
        where: { id: payload.contactId },
      });

      const properties = await prisma.property.findMany({
        where: { id: { in: payload.propertyIds } },
        include: { owner: true },
      });

      if (!contact) {
        throw new Error(`Contact ${payload.contactId} not found`);
      }

      if (properties.length === 0) {
        throw new Error(
          `No properties found for IDs: ${payload.propertyIds.join(", ")}`
        );
      }

      console.log(
        `   📦 Processing ${properties.length} properties for contact ${contact.id}`
      );

      const syntheticJob: Job = {
        id: job.id,
        type: job.name,
        payload: {
          userId: payload.userId,
          properties,
          contact,
        } as unknown as Prisma.JsonValue,
        status: "in_progress",
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: null,
        updatedAt: new Date(),
        userId: payload.userId,
      };

      await pushLeadsForUser(syntheticJob);

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "completed",
          finishedAt: new Date(),
        },
      });

      await markIdempotencyCompleted(queueName, payload.idempotencyKey, {
        jobId: job.id,
        contactId: payload.contactId,
        propertiesProcessed: properties.length,
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

      // ========================================================================
      // ✅ NEW: Alert integration - Get current job attempt count
      // ========================================================================
      const dbJob = await prisma.job.findUnique({
        where: { id: job.id },
        select: { attempts: true, maxAttempts: true },
      });

      const attempts = (dbJob?.attempts || 0) + 1;
      const maxAttempts = dbJob?.maxAttempts || 3;

      // Determine if job has exceeded max attempts
      const isFinalFailure = attempts >= maxAttempts;
      const newStatus = isFinalFailure ? "failed" : "pending";

      console.log(
        `   📊 Attempt ${attempts}/${maxAttempts} - Status: ${newStatus}`
      );

      // Mark idempotency as failed
      const queueName = this.useDailyQueue ? getTodayQueueName() : job.name;
      await markIdempotencyFailed(queueName, payload.idempotencyKey, error);

      // Update job in database
      const updatedJob = await prisma.job
        .upsert({
          where: { id: job.id },
          create: {
            id: job.id,
            type: job.name,
            payload: job.data as unknown as Prisma.InputJsonValue,
            userId: payload.userId,
            status: newStatus,
            lastError: errorMessage,
            attempts,
            maxAttempts,
          },
          update: {
            status: newStatus,
            lastError: errorMessage,
            attempts,
          },
        })
        .catch((e) => {
          console.error("Failed to update job status:", e);
          return null;
        });

      // ========================================================================
      // ✅ NEW: Send alert if max attempts reached
      // ========================================================================
      if (isFinalFailure && updatedJob) {
        console.log(
          `🚨 Job ${job.id} exceeded max attempts (${attempts}/${maxAttempts}), sending alerts...`
        );

        try {
          await sendJobFailureAlert(updatedJob);
          console.log(`✅ Alert sent successfully for job ${job.id}`);
        } catch (alertError) {
          // Don't let alert failures crash the worker
          const alertErrorMsg =
            alertError instanceof Error
              ? alertError.message
              : String(alertError);
          console.error(
            `⚠️ Failed to send alert for job ${job.id}:`,
            alertErrorMsg
          );
        }
      } else if (isFinalFailure) {
        console.warn(
          `⚠️ Job ${job.id} failed but could not retrieve from database for alert`
        );
      } else {
        console.log(
          `🔄 Job ${job.id} will be retried (${attempts}/${maxAttempts})`
        );
      }

      throw error;
    } finally {
      this.activeJobs--;
      this.emitMetrics();
    }
  }

  private async processBatchJob(job: PgBoss.Job<DeliverLeadsBatchPayload>) {
    this.activeJobs++;
    const startTime = Date.now();
    const payload: DeliverLeadsBatchPayload = job.data;

    console.log(
      `👷 Worker ${this.workerId} processing batch job ${job.id} ` +
        `(Batch ${payload.batchIndex + 1}/${payload.totalBatches}) ` +
        `(Active: ${this.activeJobs})`
    );

    try {
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
        await prisma.job.create({
          data: {
            id: job.id,
            type: job.name,
            payload: job.data as unknown as Prisma.InputJsonValue,
            userId: payload.userId,
            status: "in_progress",
            startedAt: new Date(),
            attempts: 1,
          },
        });
      }

      await this.processBatch(payload, job.id);

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
        `✅ Worker ${this.workerId} completed batch job ${job.id} ` +
          `in ${(processingTime / 1000).toFixed(2)}s`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `❌ Worker ${this.workerId} failed batch job ${job.id}:`,
        errorMessage
      );

      this.metrics.jobsFailed++;

      // ========================================================================
      // ✅ NEW: Alert integration - Get current job attempt count
      // ========================================================================
      const dbJob = await prisma.job.findUnique({
        where: { id: job.id },
        select: { attempts: true, maxAttempts: true },
      });

      const attempts = (dbJob?.attempts || 0) + 1;
      const maxAttempts = dbJob?.maxAttempts || 3;

      // Determine if job has exceeded max attempts
      const isFinalFailure = attempts >= maxAttempts;
      const newStatus = isFinalFailure ? "failed" : "pending";

      console.log(
        `   📊 Attempt ${attempts}/${maxAttempts} - Status: ${newStatus}`
      );

      // Update job in database
      const updatedJob = await prisma.job
        .upsert({
          where: { id: job.id },
          create: {
            id: job.id,
            type: job.name,
            payload: job.data as unknown as Prisma.InputJsonValue,
            userId: payload.userId,
            status: newStatus,
            lastError: errorMessage,
            attempts,
            maxAttempts,
          },
          update: {
            status: newStatus,
            lastError: errorMessage,
            attempts,
          },
        })
        .catch((e) => {
          console.error("Failed to update job status:", e);
          return null;
        });

      // ========================================================================
      // ✅ NEW: Send alert if max attempts reached
      // ========================================================================
      if (isFinalFailure && updatedJob) {
        console.log(
          `🚨 Batch job ${job.id} exceeded max attempts (${attempts}/${maxAttempts}), sending alerts...`
        );

        try {
          await sendJobFailureAlert(updatedJob);
          console.log(`✅ Alert sent successfully for batch job ${job.id}`);
        } catch (alertError) {
          // Don't let alert failures crash the worker
          const alertErrorMsg =
            alertError instanceof Error
              ? alertError.message
              : String(alertError);
          console.error(
            `⚠️ Failed to send alert for batch job ${job.id}:`,
            alertErrorMsg
          );
        }
      } else if (isFinalFailure) {
        console.warn(
          `⚠️ Batch job ${job.id} failed but could not retrieve from database for alert`
        );
      } else {
        console.log(
          `🔄 Batch job ${job.id} will be retried (${attempts}/${maxAttempts})`
        );
      }

      throw error;
    } finally {
      this.activeJobs--;
      this.emitMetrics();
    }
  }

  private async processBatch(payload: DeliverLeadsBatchPayload, jobId: string) {
    const { userId, batchIndex, batchSize, totalBatches } = payload;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true },
    });

    if (!user?.settings) {
      throw new Error("User or settings not found");
    }

    const offset = batchIndex * batchSize;

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
      `📦 Worker ${this.workerId} processing batch ${
        batchIndex + 1
      }/${totalBatches}: ` +
        `${properties.length} properties (offset: ${offset})`
    );

    await this.pushPropertiesBatch(properties, user, payload, jobId);
  }

  private async pushPropertiesBatch(
    properties: (Property & { owner: Contact | null })[],
    user: User & { settings: UserSettings | null },
    payload: DeliverLeadsBatchPayload,
    jobId: string
  ) {
    await updateJobProgress(jobId, {
      processed: payload.batchIndex * payload.batchSize,
      total: payload.totalBatches * payload.batchSize,
      status: `Processing batch ${payload.batchIndex + 1}/${
        payload.totalBatches
      }`,
    }).catch((e) => console.log("Failed to update progress:", e));

    const syntheticJob: Job = {
      id: jobId,
      type: JOB_TYPES.DELIVER_LEADS_BATCH,
      payload: {
        userId: user.id,
        properties,
      } as unknown as Prisma.JsonValue,
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

    await pushLeadsForUser(syntheticJob);

    await updateJobProgress(jobId, {
      processed: (payload.batchIndex + 1) * payload.batchSize,
      total: payload.totalBatches * payload.batchSize,
      status: `Completed batch ${payload.batchIndex + 1}/${
        payload.totalBatches
      }`,
    }).catch((e) => console.log("Failed to update progress:", e));
  }

  private emitMetrics() {
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

  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log(`🛑 Worker ${this.workerId} stopping...`);
    this.isRunning = false;

    const timeout = 30000;
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
      queueName: this.queueName,
      useDailyQueue: this.useDailyQueue,
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
