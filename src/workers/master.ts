// src/workers/master.ts
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

import {
  getQueueInstance,
  closeQueue,
  getDailyQueueName,
  JOB_TYPES,
} from "../lib/queue";
import { todayYYYYMMDD } from "../lib/timezone";
import { startDailyQueueScheduler } from "../schedulers/dailyQueueScheduler";
import { WorkerManager } from "../lib/workerManager";

const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || "10", 10);

const activeWorkers: Map<number, WorkerManager> = new Map();

async function setupQueue() {
  console.log("🔧 Setting up queue...");
  const boss = await getQueueInstance();
  console.log("✅ pg-boss started successfully");

  // Ensure queues exist
  const todayQueue = getDailyQueueName(JOB_TYPES.DAILY_LEAD_ASSIGNMENT, todayYYYYMMDD());
  await boss.createQueue(todayQueue).catch(() => { });
  await boss.createQueue(JOB_TYPES.DELIVER_LEADS_BATCH).catch(() => { });

  return boss;
}

async function startWorker(workerId: number, queueName: string): Promise<void> {
  const worker = new WorkerManager({
    workerId,
    queueName,
    concurrency: parseInt(process.env.JOB_CONCURRENCY || "10", 10)
  });

  await worker.start();
  activeWorkers.set(workerId, worker);
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n📢 Received ${signal}, starting graceful shutdown...`);

  const stopPromises = Array.from(activeWorkers.values()).map(worker => worker.stop());
  await Promise.all(stopPromises);

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

    // Start workers
    console.log(`🎯 Starting ${WORKER_COUNT} workers...\n`);

    const todayQueue = getDailyQueueName(JOB_TYPES.DAILY_LEAD_ASSIGNMENT, todayYYYYMMDD());

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
  } catch (error) {
    console.error("❌ Failed to start worker system:", error);
    process.exit(1);
  }
}

// Start the worker system
main();
