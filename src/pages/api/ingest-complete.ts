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

const prisma = new PrismaClient();

const webhookSchema = z.object({
  runId: z.union([z.string(), z.number()]).transform((val) => String(val)),
  ingestedAt: z.string().datetime(),
});

// Configurable batch size - adjust based on your needs
const PROPERTIES_PER_BATCH = parseInt(
  process.env.PROPERTIES_PER_BATCH || "100",
  10
);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log("📥 Webhook received");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const headers = req.headers;
    const hookSecret = headers["x-hook-secret"];

    if (!hookSecret || hookSecret !== process.env.WEBHOOK_SECRET) {
      console.log("❌ Invalid or missing webhook secret");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;
    if (!body) {
      console.log("❌ Empty request body");
      return res.status(400).json({ error: "Request body is required" });
    }

    // Log the webhook
    try {
      await prisma.webhookLog.create({
        data: {
          direction: "incoming",
          url: req.url!,
          payload: req.body as Prisma.InputJsonValue,
          headers: req.headers as Prisma.InputJsonValue,
          receivedAt: new Date(),
        },
      });
      console.log("✅ Webhook logged successfully");
    } catch (logError) {
      const logErrorMessage =
        logError instanceof Error ? logError.message : String(logError);
      console.error("⚠️ Failed to log webhook:", logErrorMessage);
    }

    // Validate payload
    let validatedData;
    try {
      validatedData = webhookSchema.parse(body);
      console.log("✅ Payload validated:", validatedData);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Validation failed:", errorMessage);
      return res.status(400).json({
        error: "Invalid payload format",
        details: error instanceof Error ? error.message : "Validation failed",
        received: body,
      });
    }

    console.log("🎯 Processing webhook for runId:", validatedData.runId);

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

    console.log(`📋 Found ${users.length} users to process`);

    let totalJobsCreated = 0;
    let totalPropertiesFound = 0;

    // Create batched jobs for each user
    for (const user of users) {
      if (!user.settings) {
        console.log(`⚠️ User ${user.id} has no settings, skipping`);
        continue;
      }

      // ✅ NEW: Calculate remaining limit by checking already pushed today
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
            gte: todayStart, // ✅ Use pushedAt field we just added
          },
        },
      });

      const remainingLimit = Math.max(
        0,
        user.settings.planLimit - alreadyPushed
      );

      if (remainingLimit === 0) {
        console.log(
          `ℹ️  User ${user.id} has reached plan limit (${user.settings.planLimit})`
        );
        continue;
      }

      console.log(
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

      // ✅ Apply remaining limit
      const effectiveCount = Math.min(propertyCount, remainingLimit);

      if (effectiveCount === 0) {
        console.log(`ℹ️  User ${user.id} has no properties to push`);
        continue;
      }

      totalPropertiesFound += effectiveCount;

      // Calculate number of batches based on effective count
      const batchCount = Math.ceil(effectiveCount / PROPERTIES_PER_BATCH);

      console.log(
        `👤 User ${user.id}: ${effectiveCount} properties (limit: ${remainingLimit}) → ${batchCount} batches`
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

        // Send to pg-boss queue
        const jobId = await boss.send(JOB_TYPES.DELIVER_LEADS_BATCH, payload, {
          singletonKey: `deliver-leads-batch-${user.id}-${validatedData.runId}-${batchIndex}`,
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: 3600,
        });

        if (!jobId) {
          console.error(
            `❌ Failed to create batch job for user ${user.id} batch ${batchIndex}`
          );
          continue;
        }

        // Create in database for tracking
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
        console.log(
          `✅ Created batch job ${batchIndex + 1}/${batchCount} for user ${user.id
          }`
        );
      }
    }

    console.log(`\n🎉 Job creation complete:`);
    console.log(`   📊 Properties found: ${totalPropertiesFound}`);
    console.log(`   📦 Jobs created: ${totalJobsCreated}`);
    console.log(`   👥 Users processed: ${users.length}\n`);

    // 🚀 Spawn worker process (if not using long-running workers)
    if (process.env.USE_STANDALONE_WORKERS === "true") {
      console.log("\n🔥 Spawning standalone worker process...\n");

      try {
        const workerScript = path.join(
          process.cwd(),
          "dist",
          "workers",
          "standalone.js"
        );

        const workerProcess = spawn("node", [workerScript], {
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            RUN_ID: validatedData.runId,
            JOB_COUNT: String(totalJobsCreated),
          },
        });

        workerProcess.unref();

        console.log(
          `✅ Worker process spawned with PID: ${workerProcess.pid}\n`
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("❌ Failed to spawn worker process:", errorMessage);
        // Don't fail the webhook - jobs are queued
      }
    } else {
      console.log("ℹ️  Using long-running workers (not spawning)");
    }

    return res.status(200).json({
      success: true,
      runId: validatedData.runId,
      message: "Webhook processed successfully with batched jobs",
      jobsCreated: totalJobsCreated,
      propertiesFound: totalPropertiesFound,
      totalUsers: users.length,
      batchSize: PROPERTIES_PER_BATCH,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("💥 Unexpected error:", errorMessage);
    return res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// ✅ Wrap with rate limiting - WEBHOOK tier: 10 requests/minute
export default withRateLimit(handler, {
  tier: 'WEBHOOK',
});
