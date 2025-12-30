import { PrismaClient, Job } from "@prisma/client";
import { pushLeadsForUser } from "./pushLeads";
import { createLogger, generateCorrelationId } from "./secureLogger";

const logger = createLogger('StandaloneWorker');
const prisma = new PrismaClient();

/**
 * ATOMIC JOB CLAIMING WORKER
 * 
 * This worker uses FOR UPDATE SKIP LOCKED to eliminate race conditions.
 * 
 * NOTE: This is a standalone/legacy worker. The main production system uses
 * pg-boss (via workerManager.ts and master.ts) which already handles job
 * claiming atomically. This implementation serves as a reference for atomic
 * claiming patterns and can be used for standalone deployments.
 * 
 * Race Condition Fix:
 * - Old approach: findMany -> loop -> updateMany (race window between read and update)
 * - New approach: Single atomic UPDATE with FOR UPDATE SKIP LOCKED
 * - Benefit: Zero collisions, single DB round-trip, scales to 50+ workers
 * 
 * Performance Comparison:
 * - Before: 50 workers competing for 5 jobs = 49 failed updateMany per job
 * - After: 50 workers atomically claim unique jobs = 0 collisions
 */

// Main worker logic as a function
async function runWorker() {
  logger.info("⏱  Worker tick starting...");

  // Process up to 5 jobs per tick, claiming them atomically one by one
  let processedInThisTick = 0;
  const BATCH_SIZE = 5;

  while (processedInThisTick < BATCH_SIZE) {
    // 🔒 ATOMIC CLAIM: Single query that finds AND locks a job
    // FOR UPDATE SKIP LOCKED ensures:
    // 1. Only one worker can claim each job
    // 2. Other workers skip locked rows (no waiting/collision)
    // 3. FIFO processing (ORDER BY createdAt ASC)
    const result = await prisma.$queryRaw<Job[]>`
      UPDATE "Job"
      SET 
        status = 'in_progress',
        "startedAt" = NOW(),
        attempts = attempts + 1
      WHERE id = (
        SELECT id
        FROM "Job"
        WHERE status = 'pending'
          AND attempts < "maxAttempts"
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    const job = result[0];

    // No more jobs available
    if (!job) {
      if (processedInThisTick === 0) {
        logger.info("✔ No pending jobs found.");
      }
      break;
    }

    // Generate correlation ID for this job
    const correlationId = generateCorrelationId('job', job.id);
    const jobLogger = createLogger('StandaloneWorker').withCorrelationId(correlationId);

    try {
      jobLogger.info('Claimed job, starting processing');

      // Process the job with correlation ID
      await pushLeadsForUser(job, correlationId);

      // Mark as completed
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "completed",
          finishedAt: new Date(),
        },
      });

      jobLogger.info('Job completed successfully');
    } catch (err: unknown) {
      // Handle failure
      const errorMessage = err instanceof Error ? err.message : String(err);
      const nextStatus = job.attempts >= job.maxAttempts ? "failed" : "pending";

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: nextStatus,
          lastError: errorMessage,
        },
      });

      jobLogger.error(
        `Job failed (Attempt ${job.attempts}/${job.maxAttempts}):`,
        errorMessage
      );

      // If max attempts reached, log additional context
      if (nextStatus === "failed") {
        jobLogger.error(
          'Job exceeded max attempts and marked as failed'
        );
      }
    }

    processedInThisTick++;
  }

  if (processedInThisTick > 0) {
    logger.info(`✔ Worker tick completed: ${processedInThisTick} jobs processed`);
  }
}

// Export for use in other modules
export { runWorker };

// Run immediately when script starts (if run directly)
import { fileURLToPath } from 'url';

// Check if this file is the main module being executed
if (import.meta.url && process.argv[1] === fileURLToPath(import.meta.url)) {
  runWorker();

  // Optionally schedule to run every minute with node-cron:
  // import cron from "node-cron";
  // cron.schedule("* * * * *", runWorker);
}