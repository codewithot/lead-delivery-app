// src/workers/master.ts
import { EventEmitter } from "events";
import {
  getQueueInstance,
  closeQueue,
  getDailyQueueName,
  JOB_TYPES,
} from "../lib/queue";
import { todayYYYYMMDD } from "../lib/timezone";
import { startDailyQueueScheduler } from "../schedulers/dailyQueueScheduler";
import { processLeadAssignment } from "../jobs/leadAssignment";
import { PgBoss } from "pg-boss";

// Configuration
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || "10", 10);
const JOB_CONCURRENCY = parseInt(process.env.JOB_CONCURRENCY || "10", 10);

// Event emitter for coordinating workers
const masterEvents = new EventEmitter();

// Track active workers
const activeWorkers: Set<number> = new Set();

// Worker metrics
interface WorkerMetrics {
  jobsProcessed: number;
  jobsFailed: number;
  totalProcessingTime: number;
  averageProcessingTime: number;
}

const workerMetrics = new Map<number, WorkerMetrics>();

async function setupQueue(): Promise<PgBoss> {
  console.log("🔧 Setting up queue...");

  const boss = await getQueueInstance();

  console.log("✅ pg-boss started successfully");

  // Create today's daily queue
  const todayQueue = getDailyQueueName(
    JOB_TYPES.DAILY_LEAD_ASSIGNMENT,
    todayYYYYMMDD()
  );

  try {
    await boss.createQueue(todayQueue);
    console.log(`✅ Daily queue created: ${todayQueue}`);
  } catch (error) {
    console.log(`ℹ️ Daily queue already exists: ${todayQueue}`);
  }

  // Create the batch delivery queue
  try {
    await boss.createQueue(JOB_TYPES.DELIVER_LEADS_BATCH);
    console.log(`✅ Batch queue created: ${JOB_TYPES.DELIVER_LEADS_BATCH}`);
  } catch (error) {
    console.log(
      `ℹ️ Batch queue already exists: ${JOB_TYPES.DELIVER_LEADS_BATCH}`
    );
  }

  return boss;
}

async function startWorker(workerId: number, queueName: string): Promise<void> {
  const boss = await getQueueInstance();

  console.log(`🚀 Worker ${workerId} starting...`);
  console.log(`   📍 Binding to queue: ${queueName}`);
  console.log(`   🔢 Concurrency: ${JOB_CONCURRENCY}`);

  // Initialize metrics
  workerMetrics.set(workerId, {
    jobsProcessed: 0,
    jobsFailed: 0,
    totalProcessingTime: 0,
    averageProcessingTime: 0,
  });

  // Subscribe to the queue with handler
  await boss.work(queueName, { teamSize: JOB_CONCURRENCY }, async (job) => {
    const startTime = Date.now();
    const metrics = workerMetrics.get(workerId)!;

    try {
      console.log(
        `[Worker ${workerId}] Processing job ${job.id} for user ${job.data.userId}`
      );

      await processLeadAssignment(job.data);

      const processingTime = Date.now() - startTime;
      metrics.jobsProcessed++;
      metrics.totalProcessingTime += processingTime;
      metrics.averageProcessingTime =
        metrics.totalProcessingTime / metrics.jobsProcessed;

      console.log(
        `[Worker ${workerId}] ✅ Job ${job.id} completed in ${processingTime}ms`
      );
    } catch (error) {
      metrics.jobsFailed++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[Worker ${workerId}] ❌ Job ${job.id} failed:`,
        errorMessage
      );
      throw error; // Re-throw for pg-boss retry logic
    }
  });

  console.log(`✅ Worker ${workerId} subscribed to: ${queueName}`);
  console.log(`ℹ️  Worker ${workerId} using default pg-boss concurrency`);
  console.log(`   Concurrency is controlled by total number of workers`);

  activeWorkers.add(workerId);
  console.log(`✅ Worker ${workerId} is now processing jobs`);
}

async function stopWorker(workerId: number): Promise<void> {
  console.log(`🛑 Worker ${workerId} stopping...`);
  activeWorkers.delete(workerId);

  const metrics = workerMetrics.get(workerId);
  if (metrics) {
    console.log(`✅ Worker ${workerId} stopped cleanly`);
    console.log(`📊 Final metrics for Worker ${workerId}:`, metrics);
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n📢 Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new jobs
  console.log("🛑 Stopping workers...");

  // Stop all workers
  const stopPromises = Array.from(activeWorkers).map((workerId) =>
    stopWorker(workerId)
  );
  await Promise.all(stopPromises);

  // Close queue
  console.log("🛑 Closing queue...");
  await closeQueue();

  console.log("✅ Graceful shutdown complete\n");
  process.exit(0);
}

async function main(): Promise<void> {
  try {
    console.log("🎯 Initializing worker system...\n");

    // Start the daily queue scheduler
    console.log("\n📅 Initializing Daily Queue Scheduler");
    console.log(`   Timezone: ${process.env.REGION_TZ || "America/New_York"}`);
    console.log(`   Schedule: 06:00, 06:10, 06:20\n`);

    startDailyQueueScheduler();

    console.log("✅ Daily queue scheduler started successfully\n");

    // Setup queue and create necessary queues
    await setupQueue();

    console.log(`✅ Queue created successfully\n`);

    // Start workers
    console.log(`🎯 Starting ${WORKER_COUNT} workers...\n`);

    const todayQueue = getDailyQueueName(
      JOB_TYPES.DAILY_LEAD_ASSIGNMENT,
      todayYYYYMMDD()
    );

    const workerPromises = [];
    for (let i = 1; i <= WORKER_COUNT; i++) {
      workerPromises.push(startWorker(i, todayQueue));
    }

    await Promise.all(workerPromises);

    console.log(`\n✅ All ${WORKER_COUNT} workers started successfully\n`);

    // Setup graceful shutdown
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // Handle uncaught errors
    process.on("uncaughtException", (error) => {
      console.error("💥 Uncaught Exception:", error);
      gracefulShutdown("UNCAUGHT_EXCEPTION");
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
      gracefulShutdown("UNHANDLED_REJECTION");
    });

    // Keep process alive
    masterEvents.on("worker:ready", (workerId) => {
      console.log(`ℹ️  Worker ${workerId} ready and listening`);
    });
  } catch (error) {
    console.error("❌ Failed to start worker system:", error);
    process.exit(1);
  }
}

// Start the worker system
main();
