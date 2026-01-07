// src/lib/queue.ts
import { PgBoss } from "pg-boss";
import { todayYYYYMMDD } from "./timezone";
let boss = null;
export async function getQueueInstance() {
    if (boss)
        return boss;
    // In test environment, don't actually start pg-boss to avoid processing real jobs
    if (process.env.NODE_ENV === 'test') {
        console.log('🧪 Test mode: Using mock pg-boss instance');
        // Return a minimal mock that won't process real jobs
        boss = {
            start: async () => boss,
            stop: async () => { },
            send: async () => 'mock-job-id',
            work: async () => 'mock-work-id',
            createQueue: async () => { },
            getQueueSize: async () => 0,
            on: () => boss,
        };
        return boss;
    }
    boss = new PgBoss({
        connectionString: process.env.DATABASE_URL,
        schema: "pgboss",
        // Database pool configuration
        max: parseInt(process.env.JOB_PG_POOL_MAX || "10", 10),
    });
    boss.on("error", (error) => {
        console.error("pg-boss error:", error);
    });
    await boss.start();
    console.log("✅ pg-boss started successfully");
    return boss;
}
export async function closeQueue() {
    if (boss) {
        await boss.stop({ timeout: parseInt(process.env.TIMEOUT || "30000") });
        boss = null;
        console.log("✅ pg-boss stopped");
    }
}
// Job type definitions
export const JOB_TYPES = {
    DELIVER_LEADS: "deliver-leads",
    DELIVER_LEADS_BATCH: "deliver-leads-batch",
    DAILY_LEAD_ASSIGNMENT: "leads_assign", // Changed from "leads:assign" - underscores instead of colons
};
/**
 * Generate daily queue name with date suffix
 * @param baseQueueName - Base queue name (e.g., "leads_assign")
 * @param date - Date in YYYYMMDD format
 * @returns Full queue name (e.g., "leads_assign_20250108")
 */
export function getDailyQueueName(baseQueueName, date) {
    return `${baseQueueName}_${date}`; // Changed from colon to underscore
}
/**
 * Get today's queue name based on region timezone
 */
export function getTodayQueueName() {
    return getDailyQueueName(JOB_TYPES.DAILY_LEAD_ASSIGNMENT, todayYYYYMMDD());
}
