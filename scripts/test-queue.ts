// scripts/test-queue.ts
import { PrismaClient } from "@prisma/client";
import {
  getQueueInstance,
  JOB_TYPES,
  DeliverLeadsPayload,
} from "../src/lib/queue";

const prisma = new PrismaClient();

async function testQueue() {
  console.log("🧪 Starting queue test...\n");

  try {
    // Get a test user
    const user = await prisma.user.findFirst({
      include: { settings: true },
    });

    if (!user || !user.settings) {
      console.error("❌ No user with settings found.");
      console.log(
        "💡 Please create a user with settings first via the web interface."
      );
      process.exit(1);
    }

    console.log(`✅ Found test user: ${user.email || user.name || user.id}`);

    // Get queue
    const boss = await getQueueInstance();
    console.log("✅ Queue instance obtained\n");

    // Create test payload
    const payload: DeliverLeadsPayload = {
      ingestedAt: new Date().toISOString(),
      runId: `test-${Date.now()}`,
      userId: user.id,
    };

    console.log("📦 Sending test job to queue...");

    // Send job to queue
    const jobId = await boss.send(JOB_TYPES.DELIVER_LEADS, payload, {
      singletonKey: `test-${user.id}-${Date.now()}`,
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 3600,
    });

    if (!jobId) {
      console.error("❌ Failed to create job");
      process.exit(1);
    }

    console.log(`✅ Job created with ID: ${jobId}\n`);

    // Also create in database
    await prisma.job.create({
      data: {
        id: jobId,
        type: JOB_TYPES.DELIVER_LEADS,
        payload: payload as any,
        userId: user.id,
        status: "pending",
      },
    });

    console.log("✅ Job also saved to database\n");
    console.log("📊 Job Details:");
    console.log(`   Queue: ${JOB_TYPES.DELIVER_LEADS}`);
    console.log(`   Job ID: ${jobId}`);
    console.log(`   User: ${user.email || user.name || user.id}`);
    console.log(`   Run ID: ${payload.runId}\n`);

    console.log(
      "👀 Check your worker terminal to see the job being processed!"
    );
    console.log("   The workers should pick up this job within seconds.\n");

    // Wait a bit then check status
    console.log("⏳ Waiting 10 seconds to check job status...\n");

    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Check job status in database
    const dbJob = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (dbJob) {
      console.log("📋 Final Job Status in Database:");
      console.log(`   Status: ${dbJob.status}`);
      console.log(`   Attempts: ${dbJob.attempts}`);
      if (dbJob.lastError) {
        console.log(`   Last Error: ${dbJob.lastError}`);
      }
      if (dbJob.finishedAt) {
        console.log(`   Finished At: ${dbJob.finishedAt.toISOString()}`);
      }
    }

    console.log("\n✅ Test complete!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

testQueue();
