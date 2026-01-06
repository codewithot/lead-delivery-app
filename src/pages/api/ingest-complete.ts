// src/pages/api/ingest-complete.ts
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  getQueueInstance,
  JOB_TYPES,
  DeliverLeadsBatchPayload,
} from "@/lib/queue";
import { spawn } from "child_process";
import path from "path";
import { withRateLimit } from "@/lib/apiRateLimiter";
import { createLogger, generateCorrelationId } from "@/lib/secureLogger";

const logger = createLogger('IngestWebhook');

let prisma: PrismaClient;

const webhookSchema = z.object({
  runId: z.union([z.string(), z.number()]).transform((val) => String(val)),
  ingestedAt: z.string().datetime(),
});

// Configurable batch size - adjust based on your needs
const PROPERTIES_PER_BATCH = parseInt(
  process.env.PROPERTIES_PER_BATCH || "100",
  10
);

async function processWebhookData(validatedData: { runId: string, ingestedAt: string }, correlationId: string) {
  const scopedLogger = logger.withCorrelationId(correlationId);

  try {
    // Get queue instance
    const boss = await getQueueInstance();

    await boss.createQueue(JOB_TYPES.DELIVER_LEADS_BATCH).catch(() => {
      // Queue might already exist, ignore error
    });

    // Get all users with settings
    const users = await prisma.user.findMany({
      include: {
        settings: true,
      },
    });

    scopedLogger.info(`📋 Found ${users.length} users to process`);

    let totalJobsCreated = 0;
    let totalPropertiesFound = 0;

    // Create batched jobs for each user
    for (const user of users) {
      if (!user.settings) {
        scopedLogger.info(`⚠️ User ${user.id} has no settings, skipping`);
        continue;
      }

      // Calculate remaining limit by checking already pushed today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const alreadyPushed = await prisma.property.count({
        where: {
          pushed: true,
          price: {
            gte: user.settings.priceMin ?? 0,
            lte: user.settings.priceMax ?? Number.MAX_SAFE_INTEGER,
          },
          postalCode: { in: user.settings.zipCodes },
          pushedAt: {
            gte: todayStart,
          },
        },
      });

      const remainingLimit = Math.max(
        0,
        user.settings.planLimit - alreadyPushed
      );

      if (remainingLimit === 0) {
        scopedLogger.info(
          `ℹ️  User ${user.id} has reached plan limit (${user.settings.planLimit})`
        );
        continue;
      }

      scopedLogger.info(
        `👤 User ${user.id}: Plan limit ${user.settings.planLimit}, Already pushed: ${alreadyPushed}, Remaining: ${remainingLimit}`
      );

      // Count properties that need to be pushed
      const propertyCount = await prisma.property.count({
        where: {
          price: {
            gte: user.settings.priceMin ?? 0,
            lte: user.settings.priceMax ?? Number.MAX_SAFE_INTEGER,
          },
          postalCode: { in: user.settings.zipCodes },
          pushed: false,
        },
      });

      // Apply remaining limit
      const effectiveCount = Math.min(propertyCount, remainingLimit);

      if (effectiveCount === 0) {
        scopedLogger.info(`ℹ️  User ${user.id} has no properties to push`);
        continue;
      }

      totalPropertiesFound += effectiveCount;

      // Calculate number of batches
      const batchCount = Math.ceil(effectiveCount / PROPERTIES_PER_BATCH);

      scopedLogger.info(
        `👤 User ${user.id}: ${effectiveCount} properties → ${batchCount} batches`
      );

      // Create one job per batch
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const payload: DeliverLeadsBatchPayload = {
          ingestedAt: validatedData.ingestedAt,
          runId: validatedData.runId,
          userId: user.id,
          batchIndex,
          batchSize: PROPERTIES_PER_BATCH,
          totalBatches: batchCount,
        };

        const jobId = await boss.send(JOB_TYPES.DELIVER_LEADS_BATCH, payload, {
          singletonKey: `deliver-leads-batch-${user.id}-${validatedData.runId}-${batchIndex}`,
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: 3600,
        });

        if (!jobId) {
          scopedLogger.error(
            `❌ Failed to create batch job for user ${user.id} batch ${batchIndex}`
          );
          continue;
        }

        await prisma.job.create({
          data: {
            id: jobId,
            type: JOB_TYPES.DELIVER_LEADS_BATCH,
            payload: JSON.parse(
              JSON.stringify(payload)
            ) as Prisma.InputJsonValue,
            userId: user.id,
            status: "pending",
          },
        });

        totalJobsCreated++;
      }
    }

    scopedLogger.info(`🎉 Job creation complete for Run ${validatedData.runId}`, {
      propertiesFound: totalPropertiesFound,
      jobsCreated: totalJobsCreated
    });

    if (process.env.USE_STANDALONE_WORKERS === "true") {
      try {
        const workerScript = path.join(process.cwd(), "dist", "workers", "standalone.js");
        const workerProcess = spawn("node", [workerScript], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, RUN_ID: validatedData.runId, JOB_COUNT: String(totalJobsCreated) },
        });
        workerProcess.unref();
      } catch (error) {
        scopedLogger.error("❌ Failed to spawn worker process", { error: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    scopedLogger.error("💥 Error processing webhook background tasks", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!prisma) {
    prisma = new PrismaClient();
  }

  const correlationId =
    (req.headers['x-correlation-id'] as string) ||
    generateCorrelationId('webhook-ingest', Date.now());
  const scopedLogger = logger.withCorrelationId(correlationId);

  scopedLogger.info('Webhook received');

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const hookSecret = req.headers["x-hook-secret"];
    if (!hookSecret || hookSecret !== process.env.WEBHOOK_SECRET) {
      scopedLogger.info('Invalid or missing webhook secret');
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;
    if (!body) {
      return res.status(400).json({ error: "Request body is required" });
    }

    // Standard Next.js behavior is to have the body parsed already
    // but we log it first for auditability
    try {
      await prisma.webhookLog.create({
        data: {
          direction: "incoming",
          url: req.url!,
          payload: body as Prisma.InputJsonValue,
          headers: req.headers as Prisma.InputJsonValue,
          receivedAt: new Date(),
        },
      });
    } catch (logError) {
      scopedLogger.error("⚠️ Failed to log webhook", { error: logError instanceof Error ? logError.message : String(logError) });
    }

    // Validate payload
    const result = webhookSchema.safeParse(body);
    if (!result.success) {
      return res.status(400).json({
        error: "Invalid payload format",
        details: result.error.message,
      });
    }

    const validatedData = result.data;
    scopedLogger.info('Payload validated, responding immediately', { runId: validatedData.runId });

    // 🚀 RESPOND IMMEDIATELY TO PREVENT TIMEOUTS
    res.status(200).json({
      success: true,
      message: "Webhook accepted for background processing",
      runId: validatedData.runId
    });

    // ⚡️ TRIGGER BACKGROUND PROCESSING
    // Note: In long-running processes (like local dev), this works fine.
    // In serverless, you would use a queue or a separate lambda.
    setImmediate(() => {
      processWebhookData(validatedData, correlationId);
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    scopedLogger.error("💥 Unexpected webhook error", { error: errorMessage });
    if (!res.writableEnded) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}

// ✅ Wrap with rate limiting - WEBHOOK tier: 10 requests/minute
export default withRateLimit(handler, {
  tier: 'WEBHOOK',
});
