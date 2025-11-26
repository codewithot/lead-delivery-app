// src/pages/api/ingest-complete.ts
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { PrismaClient, User, UserSettings } from "@prisma/client";
import { getQueueInstance, JOB_TYPES, DeliverLeadsPayload } from "@/lib/queue";
import { spawn } from "child_process";
import path from "path";

const prisma = new PrismaClient();

type UserWithSettings = User & {
  settings: UserSettings | null;
};

const webhookSchema = z.object({
  runId: z.union([z.string(), z.number()]).transform((val) => String(val)),
  ingestedAt: z.string().datetime(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log("🔗 Webhook received");

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
          payload: req.body,
          headers: req.headers as any,
          receivedAt: new Date(),
        },
      });
      console.log("✅ Webhook logged successfully");
    } catch (logError) {
      console.error("⚠️ Failed to log webhook:", logError);
    }

    // Validate payload
    let validatedData;
    try {
      validatedData = webhookSchema.parse(body);
      console.log("✅ Payload validated:", validatedData);
    } catch (error) {
      console.error("❌ Validation failed:", error);
      return res.status(400).json({
        error: "Invalid payload format",
        details: error instanceof Error ? error.message : "Validation failed",
        received: body,
      });
    }

    console.log("🎯 Processing webhook for runId:", validatedData.runId);

    // Get queue instance
    const boss = await getQueueInstance();

    await boss.createQueue(JOB_TYPES.DELIVER_LEADS).catch(() => {
      // Queue might already exist, ignore error
    });

    // Get all users with settings
    const users = await prisma.user.findMany({
      include: {
        settings: true,
      },
    });

    console.log(`📋 Found ${users.length} users to process`);

    // Create jobs in pg-boss queue
    const jobPromises = users.map(async (user: UserWithSettings) => {
      if (!user.settings) {
        console.log(`⚠️ User ${user.id} has no settings, skipping`);
        return null;
      }

      const payload: DeliverLeadsPayload = {
        ingestedAt: validatedData.ingestedAt,
        runId: validatedData.runId,
        userId: user.id,
      };

      // Send to pg-boss queue
      const jobId = await boss.send(JOB_TYPES.DELIVER_LEADS, payload, {
        singletonKey: `deliver-leads-${user.id}-${validatedData.runId}`,
        retryLimit: 3,
        retryDelay: 60,
        retryBackoff: true,
        expireInSeconds: 3600,
      });

      if (!jobId) {
        console.error(`❌ Failed to create job for user ${user.id}`);
        return null;
      }

      // Also create in database for tracking
      const job = await prisma.job.create({
        data: {
          id: jobId,
          type: JOB_TYPES.DELIVER_LEADS,
          payload: payload as any,
          userId: user.id,
          status: "pending",
        },
      });

      console.log(`✅ Created job ${jobId} for user ${user.id}`);
      return job;
    });

    const jobs = await Promise.all(jobPromises);
    const successfulJobs = jobs.filter((job) => job !== null);

    console.log(`🎉 Successfully queued ${successfulJobs.length} jobs`);

    // 🚀 NEW: Spawn worker process as a detached child
    console.log("\n🔥 Spawning worker process...\n");

    try {
      const workerScript = path.join(
        process.cwd(),
        "dist",
        "workers",
        "standalone.js"
      );

      // Spawn as detached process that will run independently
      const workerProcess = spawn("node", [workerScript], {
        detached: true,
        stdio: "ignore", // Don't pipe stdio, let it run independently
        env: {
          ...process.env,
          RUN_ID: validatedData.runId,
          JOB_COUNT: String(successfulJobs.length),
        },
      });

      // Unreference the child so parent can exit
      workerProcess.unref();

      console.log(`✅ Worker process spawned with PID: ${workerProcess.pid}\n`);
    } catch (error) {
      console.error("❌ Failed to spawn worker process:", error);
      // Don't fail the webhook - jobs are queued and can be processed manually
    }

    // Return immediately - workers will run independently
    return res.status(200).json({
      success: true,
      runId: validatedData.runId,
      message: "Webhook processed successfully and worker process spawned",
      jobsCreated: successfulJobs.length,
      totalUsers: users.length,
    });
  } catch (error) {
    console.error("💥 Unexpected error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
