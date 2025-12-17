// src/scripts/test-rate-limit.ts
// Run with: npx tsx src/scripts/test-rate-limit.ts
import axios from "axios";

const BASE_URL = "http://localhost:3000";

async function testRateLimit() {
    console.log("🧪 Testing Rate Limiting\n");
    console.log("📋 WEBHOOK tier: 10 requests/minute, 5-min block on exceed\n");

    let successCount = 0;
    let rateLimitedCount = 0;

    for (let i = 1; i <= 15; i++) {
        try {
            const response = await axios.get(`${BASE_URL}/api/test-rate-limit`);

            const limit = response.headers["x-ratelimit-limit"];
            const remaining = response.headers["x-ratelimit-remaining"];

            console.log(
                `   Request ${i.toString().padStart(2)}: ✅ Success | Limit: ${limit} | Remaining: ${remaining}`
            );
            successCount++;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 429) {
                const retryAfter = error.response.headers["retry-after"];
                const data = error.response.data as { message?: string };
                console.log(
                    `   Request ${i.toString().padStart(2)}: ❌ Rate limited | Retry after: ${retryAfter}s | ${data.message || ""}`
                );
                rateLimitedCount++;
            } else if (axios.isAxiosError(error)) {
                console.log(
                    `   Request ${i.toString().padStart(2)}: ❌ Error: ${error.response?.status} - ${error.message}`
                );
            } else {
                console.log(
                    `   Request ${i.toString().padStart(2)}: ❌ Error: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log("\n📊 Summary:");
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Rate limited: ${rateLimitedCount}`);

    if (successCount === 10 && rateLimitedCount === 5) {
        console.log("\n🎉 Rate limiting is working correctly!");
    } else if (rateLimitedCount > 0) {
        console.log("\n✅ Rate limiting is active (counts may vary based on prior requests)");
    } else {
        console.log("\n⚠️ No rate limiting detected - check your configuration");
    }
}

testRateLimit().catch(console.error);
