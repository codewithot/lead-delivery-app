"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JOB_TYPES = void 0;
exports.getQueueInstance = getQueueInstance;
exports.closeQueue = closeQueue;
exports.getDailyQueueName = getDailyQueueName;
exports.getTodayQueueName = getTodayQueueName;
// src/lib/queue.ts
const pg_boss_1 = require("pg-boss");
const timezone_1 = require("./timezone");
let boss = null;
async function getQueueInstance() {
    if (boss)
        return boss;
    boss = new pg_boss_1.PgBoss({
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
async function closeQueue() {
    if (boss) {
        await boss.stop({ timeout: 30000 });
        boss = null;
        console.log("✅ pg-boss stopped");
    }
}
// Job type definitions
exports.JOB_TYPES = {
    DELIVER_LEADS: "deliver-leads",
    DELIVER_LEADS_BATCH: "deliver-leads-batch",
    DAILY_LEAD_ASSIGNMENT: "leads:assign", // Base name, will be suffixed with :YYYYMMDD
};
/**
 * Generate daily queue name with date suffix
 * @param baseQueueName - Base queue name (e.g., "leads:assign")
 * @param date - Date in YYYYMMDD format
 * @returns Full queue name (e.g., "leads:assign:20250108")
 */
function getDailyQueueName(baseQueueName, date) {
    return `${baseQueueName}:${date}`;
}
/**
 * Get today's queue name based on region timezone
 */
function getTodayQueueName() {
    return getDailyQueueName(exports.JOB_TYPES.DAILY_LEAD_ASSIGNMENT, (0, timezone_1.todayYYYYMMDD)());
}
