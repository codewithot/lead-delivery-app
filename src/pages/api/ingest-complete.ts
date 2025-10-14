import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { PrismaClient, User, UserSettings } from "@prisma/client";

const prisma = new PrismaClient();

// Type for user with settings
type UserWithSettings = User & {
  settings: UserSettings | null;
};

// Validation schema
const webhookSchema = z.object({
  runId: z.union([z.string(), z.number()]).transform((val) => String(val)),
  ingestedAt: z.string().datetime(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log("🔗 Webhook received");

  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Get headers for logging
    const headers = req.headers;
    console.log("📋 Headers:", headers);

    // Verify webhook secret
    const hookSecret = headers["x-hook-secret"];
    if (!hookSecret || hookSecret !== process.env.WEBHOOK_SECRET) {
      console.log("❌ Invalid or missing webhook secret");
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get request body (Pages Router automatically parses JSON)
    const body = req.body;
    console.log("📦 Raw body:", body);

    // Check if body exists
    if (!body) {
      console.log("❌ Empty request body");
      return res.status(400).json({ error: "Request body is required" });
    }

    // Log the webhook (this should work with your schema now)
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
      console.error("⚠️ Failed to log webhook (continuing anyway):", logError);
      // Don't fail the webhook just because logging failed
    }

    // Validate the payload
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

    // Core Logic: Create jobs for all users to deliver leads
    try {
      // Get all users with their settings
      const users = await prisma.user.findMany({
        include: {
          settings: true,
        },
      });

      console.log(`📋 Found ${users.length} users to process`);

      // Create a job for each user
      const jobPromises = users.map(async (user: UserWithSettings) => {
        if (!user.settings) {
          console.log(`⚠️ User ${user.id} has no settings, skipping`);
          return null;
        }

        const job = await prisma.job.create({
          data: {
            type: "deliver-leads",
            payload: {
              ingestedAt: validatedData.ingestedAt,
              runId: validatedData.runId,
              userId: user.id,
            },
            userId: user.id,
            status: "pending",
          },
        });

        console.log(`✅ Created job ${job.id} for user ${user.id}`);
        return job;
      });

      const jobs = await Promise.all(jobPromises);
      const successfulJobs = jobs.filter((job) => job !== null);

      console.log(`🎉 Successfully created ${successfulJobs.length} jobs`);

      return res.status(200).json({
        success: true,
        runId: validatedData.runId,
        message: "Webhook processed successfully",
        jobsCreated: successfulJobs.length,
        totalUsers: users.length,
      });
    } catch (processingError) {
      console.error("❌ Failed to process webhook:", processingError);
      return res.status(500).json({
        error: "Failed to process webhook",
        details:
          processingError instanceof Error
            ? processingError.message
            : "Unknown error",
      });
    }
  } catch (error) {
    console.error("💥 Unexpected error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
