"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndClaimIdempotency = checkAndClaimIdempotency;
exports.markIdempotencyCompleted = markIdempotencyCompleted;
exports.markIdempotencyFailed = markIdempotencyFailed;
exports.generateIdempotencyKey = generateIdempotencyKey;
exports.cleanupOldIdempotencyRecords = cleanupOldIdempotencyRecords;
// src/lib/idempotency.ts
const client_1 = require("@prisma/client");
const client_2 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
/**
 * Check if a job with this idempotency key has already been processed
 * If not, claim it atomically
 *
 * @param queueName - Name of the queue (e.g., "leads:assign:20250108")
 * @param idempotencyKey - Unique key for this job (e.g., "contact-123:20250108")
 * @param jobId - Current job ID attempting to process
 * @returns Result indicating whether to process and any existing results
 */
async function checkAndClaimIdempotency(queueName, idempotencyKey, jobId) {
    try {
        // Try to create a new idempotency record
        await prisma.jobIdempotency.create({
            data: {
                queueName,
                idempotencyKey,
                jobId,
                status: "processing",
            },
        });
        console.log(`✅ Claimed idempotency key: ${idempotencyKey}`);
        return { shouldProcess: true };
    }
    catch (error) {
        // Check if it's a Prisma error
        if (error instanceof client_2.Prisma.PrismaClientKnownRequestError) {
            // If unique constraint fails, job already exists
            if (error.code === "P2002") {
                console.log(`⚠️ Idempotency key already exists: ${idempotencyKey}`);
                // Fetch the existing record
                const existing = await prisma.jobIdempotency.findUnique({
                    where: {
                        queueName_idempotencyKey: {
                            queueName,
                            idempotencyKey,
                        },
                    },
                });
                if (!existing) {
                    console.error(`❌ Race condition: record disappeared`);
                    return { shouldProcess: true };
                }
                // If the existing job is completed, return its result
                if (existing.status === "completed") {
                    console.log(`✅ Job already completed: ${existing.jobId}`);
                    return {
                        shouldProcess: false,
                        existingJobId: existing.jobId,
                        existingResult: existing.result,
                    };
                }
                // If still processing, skip (another worker is handling it)
                console.log(`⏳ Job still processing: ${existing.jobId}`);
                return {
                    shouldProcess: false,
                    existingJobId: existing.jobId,
                };
            }
        }
        // Other error - log and allow processing (fail-safe)
        console.error(`❌ Idempotency check error:`, error);
        return { shouldProcess: true };
    }
}
/**
 * Mark an idempotency record as completed
 */
async function markIdempotencyCompleted(queueName, idempotencyKey, result) {
    try {
        await prisma.jobIdempotency.update({
            where: {
                queueName_idempotencyKey: {
                    queueName,
                    idempotencyKey,
                },
            },
            data: {
                status: "completed",
                completedAt: new Date(),
                result: result !== undefined
                    ? result
                    : client_2.Prisma.JsonNull, // ✅ Use Prisma.JsonNull instead of null
            },
        });
        console.log(`✅ Marked idempotency completed: ${idempotencyKey}`);
    }
    catch (error) {
        console.error(`❌ Failed to mark idempotency completed:`, error);
    }
}
/**
 * Mark an idempotency record as failed
 */
async function markIdempotencyFailed(queueName, idempotencyKey, error) {
    try {
        await prisma.jobIdempotency.update({
            where: {
                queueName_idempotencyKey: {
                    queueName,
                    idempotencyKey,
                },
            },
            data: {
                status: "failed",
                completedAt: new Date(),
                result: {
                    error: error instanceof Error ? error.message : String(error),
                },
            },
        });
        console.log(`❌ Marked idempotency failed: ${idempotencyKey}`);
    }
    catch (err) {
        console.error(`❌ Failed to mark idempotency failed:`, err);
    }
}
/**
 * Generate idempotency key for a contact/property
 * Format: {type}-{id}:{YYYYMMDD}
 */
function generateIdempotencyKey(type, id, date) {
    return `${type}-${id}:${date}`;
}
/**
 * Clean up old idempotency records (optional maintenance task)
 * Keep records for N days, then delete
 */
async function cleanupOldIdempotencyRecords(daysToKeep = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const result = await prisma.jobIdempotency.deleteMany({
        where: {
            createdAt: {
                lt: cutoffDate,
            },
            status: {
                in: ["completed", "failed"],
            },
        },
    });
    console.log(`🧹 Cleaned up ${result.count} old idempotency records`);
    return result.count;
}
