import cron from "node-cron";
import { provisionWithRetry } from "../jobs/provisionDailyQueues";

export function startDailyQueueScheduler() {
  const timezone = process.env.REGION_TZ || "America/New_York";

  console.log(`\n📅 Initializing Daily Queue Scheduler`);
  console.log(`   Timezone: ${timezone}`);
  console.log(`   Schedule: 06:00, 06:10, 06:20\n`);

  // Main provision at 06:00 EST
  cron.schedule(
    "0 6 * * *",
    async () => {
      console.log("\n🎯 ============================================");
      console.log("🕐 06:00 EST - Starting daily queue provision");
      console.log("============================================\n");
      try {
        await provisionWithRetry();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("❌ Critical error in 06:00 provision:", errorMessage);
      }
    },
    {
      timezone,
    }
  );

  // First retry at 06:10 EST
  cron.schedule(
    "10 6 * * *",
    async () => {
      console.log("\n🔄 ============================================");
      console.log("🕐 06:10 EST - Retry #1 for failed provisions");
      console.log("============================================\n");
      try {
        await provisionWithRetry();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("❌ Error in 06:10 retry:", errorMessage);
      }
    },
    {
      timezone,
    }
  );

  // Second retry at 06:20 EST
  cron.schedule(
    "20 6 * * *",
    async () => {
      console.log("\n🔄 ============================================");
      console.log("🕐 06:20 EST - Retry #2 for failed provisions");
      console.log("============================================\n");
      try {
        await provisionWithRetry();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("❌ Error in 06:20 retry:", errorMessage);
      }
    },
    {
      timezone,
    }
  );

  console.log("✅ Daily queue scheduler started successfully\n");
}
