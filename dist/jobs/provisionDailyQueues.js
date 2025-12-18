// src/jobs/provisionDailyQueues.ts
import { PrismaClient } from "@prisma/client";
import { getQueueInstance, JOB_TYPES, getDailyQueueName, } from "../lib/queue";
import { todayYYYYMMDD, getRegionTimezone, formatForLog, getProvisionTimes, } from "../lib/timezone";
import { generateIdempotencyKey } from "../lib/idempotency";
import { DateTime } from "luxon";
import { createLogger } from "@/lib/secureLogger";
const logger = createLogger('ProvisionQueues');
const prisma = new PrismaClient();
/**
 * Helper: Convert YYYYMMDD string to DateTime
 */
function dateTimeFromYYYYMMDD(date) {
    const year = date.slice(0, 4);
    const month = date.slice(4, 6);
    const day = date.slice(6, 8);
    return DateTime.fromISO(`${year}-${month}-${day}`, {
        zone: getRegionTimezone(),
    });
}
/**
 * Check if properties were pushed earlier today
 * This prevents counting properties from previous days
 */
async function getPropertiesPushedToday(userId, settings, date) {
    const startOfDay = dateTimeFromYYYYMMDD(date).startOf("day").toJSDate();
    const endOfDay = dateTimeFromYYYYMMDD(date).endOf("day").toJSDate();
    const count = await prisma.property.count({
        where: {
            price: {
                gte: settings.priceMin ?? 0,
                lte: settings.priceMax ?? Number.MAX_SAFE_INTEGER,
            },
            postalCode: { in: settings.zipCodes },
            pushed: true,
            pushedAt: {
                gte: startOfDay,
                lte: endOfDay,
            },
        },
    });
    return count;
}
/**
 * Main provision function - creates daily queue and enqueues jobs
 */
export async function provisionDailyQueues(options = {}) {
    const startTime = DateTime.now().setZone(getRegionTimezone());
    const date = options.forceDate || todayYYYYMMDD();
    const queueName = getDailyQueueName(JOB_TYPES.DAILY_LEAD_ASSIGNMENT, date);
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📅 Provisioning Daily Queue: ${queueName}`);
    console.log(`⏰ Started at: ${formatForLog(startTime)}`);
    console.log(`🌎 Timezone: ${getRegionTimezone()}`);
    console.log(`${"=".repeat(60)}\n`);
    const result = {
        success: false,
        date,
        queueName,
        jobsCreated: 0,
        contactsProcessed: 0,
        propertiesProcessed: 0,
        timestamp: startTime.toISO(),
    };
    try {
        // Step 1: Check if data is ready
        const dataReady = await checkDataReady(date);
        if (!dataReady) {
            const error = "Data not ready for ingestion";
            console.warn(`⚠️ ${error}`);
            result.error = error;
            return result;
        }
        // Step 2: Get queue instance and create queue
        const boss = await getQueueInstance();
        if (!options.dryRun) {
            try {
                await boss.createQueue(queueName);
                console.log(`✅ Queue created/verified: ${queueName}`);
            }
            catch (error) {
                console.log(`ℹ️ Queue already exists: ${queueName}`);
                console.log(error);
            }
        }
        // Step 3: Fetch all users with settings
        const users = await prisma.user.findMany({
            where: {
                settings: {
                    isNot: null,
                },
            },
            include: {
                settings: true,
            },
        });
        console.log(`👥 Found ${users.length} users with settings\n`);
        // Step 4: For each user, fetch matching properties and create jobs
        for (const user of users) {
            if (!user.settings)
                continue;
            logger.info("Processing user", { userId: user.id });
            // ✅ NEW: Check how many properties already pushed today
            const alreadyPushedCount = await getPropertiesPushedToday(user.id, user.settings, date);
            const remainingLimit = Math.max(0, user.settings.planLimit - alreadyPushedCount);
            if (remainingLimit === 0) {
                console.log(`   ⚠️ Plan limit reached (${user.settings.planLimit}), skipping`);
                continue;
            }
            console.log(`   📊 Plan limit: ${user.settings.planLimit}, Already pushed: ${alreadyPushedCount}, Remaining: ${remainingLimit}`);
            // Fetch properties that match user's criteria and haven't been pushed
            const properties = await prisma.property.findMany({
                where: {
                    price: {
                        gte: user.settings.priceMin ?? 0,
                        lte: user.settings.priceMax ?? Number.MAX_SAFE_INTEGER,
                    },
                    postalCode: { in: user.settings.zipCodes },
                    pushed: false,
                },
                include: {
                    owner: true,
                },
                take: remainingLimit, // ✅ Use remaining limit, not full plan limit
                orderBy: {
                    createdAt: "asc", // ✅ FIFO ordering - oldest properties first
                },
            });
            console.log(`   📊 Found ${properties.length} matching properties (limit: ${remainingLimit})`);
            if (properties.length === 0) {
                console.log(`   ℹ️ No properties to process, skipping`);
                continue;
            }
            // Group properties by contact (owner)
            const contactPropertyMap = new Map();
            const uniqueContacts = new Set();
            for (const property of properties) {
                if (property.ownerId) {
                    uniqueContacts.add(property.ownerId);
                    if (!contactPropertyMap.has(property.ownerId)) {
                        contactPropertyMap.set(property.ownerId, []);
                    }
                    contactPropertyMap.get(property.ownerId).push(property.id);
                }
            }
            console.log(`   👥 Grouped into ${uniqueContacts.size} unique contacts`);
            // Create one job per contact (with their properties)
            let jobsCreatedForUser = 0;
            for (const [contactId, propertyIds] of contactPropertyMap) {
                const idempotencyKey = generateIdempotencyKey("contact", contactId, date);
                const payload = {
                    userId: user.id,
                    contactId,
                    propertyIds,
                    date,
                    idempotencyKey,
                };
                if (options.dryRun) {
                    console.log(`   [DRY RUN] Would create job for contact ${contactId} with ${propertyIds.length} properties`);
                }
                else {
                    try {
                        const jobId = await boss.send(queueName, payload, {
                            singletonKey: idempotencyKey,
                            retryLimit: 3,
                            retryDelay: 60,
                            retryBackoff: true,
                            expireInSeconds: 3600, // Jobs expire after 1 hour
                        });
                        if (jobId) {
                            jobsCreatedForUser++;
                            result.jobsCreated++;
                            // Create corresponding database record
                            await prisma.job.create({
                                data: {
                                    id: jobId,
                                    type: queueName,
                                    payload: payload,
                                    userId: user.id,
                                    status: "pending",
                                },
                            });
                        }
                    }
                    catch (err) {
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        console.error(`   ❌ Failed to create job for contact ${contactId}:`, errorMessage);
                    }
                }
            }
            result.contactsProcessed += uniqueContacts.size;
            result.propertiesProcessed += properties.length;
            console.log(`   ✅ Created ${jobsCreatedForUser} jobs for this user`);
        }
        result.success = true;
        console.log(`\n${"=".repeat(60)}`);
        console.log(`✅ Provision Complete`);
        console.log(`   📊 Jobs Created: ${result.jobsCreated}`);
        console.log(`   👥 Contacts: ${result.contactsProcessed}`);
        console.log(`   🏠 Properties: ${result.propertiesProcessed}`);
        console.log(`   ⏱️ Duration: ${DateTime.now()
            .diff(startTime, "seconds")
            .seconds.toFixed(2)}s`);
        console.log(`${"=".repeat(60)}\n`);
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.error = errorMessage;
        console.error(`\n❌ Provision failed:`, error);
        return result;
    }
}
/**
 * Check if data is ready for the given date
 * This would check if the nightly ingestion has completed
 */
async function checkDataReady(date) {
    try {
        // Check if there's a completed ingestion run for this date
        // You might check a specific table or marker
        const run = await prisma.ingestionRun.findFirst({
            where: {
                status: "completed",
                startedAt: {
                    gte: new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`),
                },
            },
            orderBy: {
                startedAt: "desc",
            },
        });
        return !!run;
    }
    catch (error) {
        console.warn("⚠️ Could not check data ready status:", error);
        // Fail-safe: assume data is ready
        return true;
    }
}
/**
 * Provision with retry logic (06:00, 06:10, 06:20)
 */
export async function provisionWithRetry(options = {}) {
    const maxRetries = options.maxRetries || 3;
    const times = getProvisionTimes();
    console.log(`\n⏰ Provision Schedule:`);
    console.log(`   First attempt: ${formatForLog(times.first)}`);
    console.log(`   Retry 1: ${formatForLog(times.retry1)}`);
    console.log(`   Retry 2: ${formatForLog(times.retry2)}\n`);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`\n🔄 Provision Attempt ${attempt}/${maxRetries}`);
        const result = await provisionDailyQueues(options);
        if (result.success) {
            console.log(`✅ Provision successful on attempt ${attempt}`);
            return result;
        }
        if (attempt < maxRetries) {
            const delayMinutes = 10; // Wait 10 minutes between retries
            console.log(`⏳ Waiting ${delayMinutes} minutes before retry...`);
            await new Promise((resolve) => setTimeout(resolve, delayMinutes * 60 * 1000));
        }
    }
    console.error(`❌ Provision failed after ${maxRetries} attempts`);
    return {
        success: false,
        date: todayYYYYMMDD(),
        queueName: getDailyQueueName(JOB_TYPES.DAILY_LEAD_ASSIGNMENT, todayYYYYMMDD()),
        jobsCreated: 0,
        contactsProcessed: 0,
        propertiesProcessed: 0,
        error: `Failed after ${maxRetries} attempts`,
        timestamp: new Date().toISOString(),
    };
}
/**
 * CLI entry point - ESM compatible
 */
const isMainModule = process.argv[1] === new URL(import.meta.url).pathname ||
    process.argv[1] === new URL(import.meta.url).pathname.replace(/\//g, "\\");
if (isMainModule) {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const withRetry = args.includes("--retry");
    console.log(`\n🚀 Starting Daily Queue Provisioning`);
    console.log(`   Dry Run: ${dryRun ? "Yes" : "No"}`);
    console.log(`   Retry: ${withRetry ? "Yes" : "No"}\n`);
    const provisionFn = withRetry ? provisionWithRetry : provisionDailyQueues;
    provisionFn({ dryRun })
        .then((result) => {
        if (result.success) {
            console.log(`\n✅ Provisioning completed successfully`);
            process.exit(0);
        }
        else {
            console.error(`\n❌ Provisioning failed: ${result.error}`);
            process.exit(1);
        }
    })
        .catch((error) => {
        console.error(`\n💥 Unexpected error:`, error);
        process.exit(1);
    });
}
