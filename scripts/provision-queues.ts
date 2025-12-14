import { provisionWithRetry } from "@/jobs/provisionDailyQueues";

async function main() {
  console.log("🎯 Manual queue provision triggered\n");
  await provisionWithRetry();
  console.log("\n✅ Manual provision complete");
  process.exit(0);
}

main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("❌ Error:", errorMessage);
  process.exit(1);
});
