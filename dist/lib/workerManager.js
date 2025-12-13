"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerManager = void 0;
// src/lib/workerManager.ts - FULLY FIXED VERSION
const queue_1 = require("./queue");
const client_1 = require("@prisma/client");
const monitoring_1 = require("./monitoring");
const events_1 = require("events");
const jobProgress_1 = require("./jobProgress");
const idempotency_1 = require("./idempotency");
const pushLeads_1 = require("./pushLeads");
const prisma = new client_1.PrismaClient();
class WorkerManager {
    constructor(config, eventEmitter) {
        this.isRunning = false;
        this.activeJobs = 0;
        this.metrics = {
            jobsProcessed: 0,
            jobsFailed: 0,
            totalProcessingTime: 0,
        };
        this.workerId = config.workerId;
        this.queueName = config.queueName;
        this.useDailyQueue = config.useDailyQueue ?? false;
        this.concurrency =
            config.concurrency ?? parseInt(process.env.JOB_CONCURRENCY || "10", 10);
        this.eventEmitter = eventEmitter ?? new events_1.EventEmitter();
    }
    async start() {
        if (this.isRunning) {
            console.log(`⚠️ Worker ${this.workerId} is already running`);
            return;
        }
        console.log(`🚀 Worker ${this.workerId} starting...`);
        const targetQueue = this.useDailyQueue
            ? (0, queue_1.getTodayQueueName)()
            : this.queueName;
        if (targetQueue) {
            console.log(`   📍 Binding to queue: ${targetQueue}`);
        }
        else {
            console.log(`   📍 Binding to all queues`);
        }
        console.log(`   🔢 Concurrency: ${this.concurrency}`);
        this.isRunning = true;
        (0, monitoring_1.setupMemoryMonitoring)(this.workerId);
        const boss = await (0, queue_1.getQueueInstance)();
        await boss.work(queue_1.JOB_TYPES.DELIVER_LEADS_BATCH, async (jobs) => {
            const jobArray = Array.isArray(jobs) ? jobs : [jobs];
            const job = jobArray[0];
            await this.processBatchJob(job);
        });
        if (this.useDailyQueue || targetQueue) {
            const queueToSubscribe = targetQueue || (0, queue_1.getTodayQueueName)();
            await boss.work(queueToSubscribe, async (jobs) => {
                const jobArray = Array.isArray(jobs) ? jobs : [jobs];
                const job = jobArray[0];
                await this.processDailyLeadJob(job);
            });
            console.log(`✅ Worker ${this.workerId} subscribed to: ${queueToSubscribe}`);
        }
        console.log(`ℹ️  Worker ${this.workerId} using default pg-boss concurrency`);
        console.log(`   Concurrency is controlled by total number of workers`);
        console.log(`✅ Worker ${this.workerId} is now processing jobs`);
    }
    async processDailyLeadJob(job) {
        this.activeJobs++;
        const startTime = Date.now();
        const payload = job.data;
        console.log(`👷 Worker ${this.workerId} processing daily lead job ${job.id} ` +
            `(Contact: ${payload.contactId}, Properties: ${payload.propertyIds.length}) ` +
            `(Active: ${this.activeJobs})`);
        try {
            const queueName = this.useDailyQueue ? (0, queue_1.getTodayQueueName)() : job.name;
            const idempotencyCheck = await (0, idempotency_1.checkAndClaimIdempotency)(queueName, payload.idempotencyKey, job.id);
            if (!idempotencyCheck.shouldProcess) {
                console.log(`⏩ Skipping job ${job.id} - already processed (idempotency)`);
                return;
            }
            const existingJob = await prisma.job.findUnique({
                where: { id: job.id },
            });
            if (existingJob) {
                await prisma.job.update({
                    where: { id: job.id },
                    data: {
                        status: "in_progress",
                        startedAt: new Date(),
                        attempts: { increment: 1 },
                    },
                });
            }
            else {
                await prisma.job.create({
                    data: {
                        id: job.id,
                        type: job.name,
                        payload: job.data,
                        userId: payload.userId,
                        status: "in_progress",
                        startedAt: new Date(),
                        attempts: 1,
                    },
                });
            }
            const contact = await prisma.contact.findUnique({
                where: { id: payload.contactId },
            });
            const properties = await prisma.property.findMany({
                where: { id: { in: payload.propertyIds } },
                include: { owner: true },
            });
            if (!contact) {
                throw new Error(`Contact ${payload.contactId} not found`);
            }
            if (properties.length === 0) {
                throw new Error(`No properties found for IDs: ${payload.propertyIds.join(", ")}`);
            }
            console.log(`   📦 Processing ${properties.length} properties for contact ${contact.id}`);
            const syntheticJob = {
                id: job.id,
                type: job.name,
                payload: {
                    userId: payload.userId,
                    properties,
                    contact,
                },
                status: "in_progress",
                attempts: 0,
                maxAttempts: 3,
                lastError: null,
                createdAt: new Date(),
                startedAt: new Date(),
                finishedAt: null,
                updatedAt: new Date(),
                userId: payload.userId,
            };
            await (0, pushLeads_1.pushLeadsForUser)(syntheticJob);
            await prisma.job.update({
                where: { id: job.id },
                data: {
                    status: "completed",
                    finishedAt: new Date(),
                },
            });
            await (0, idempotency_1.markIdempotencyCompleted)(queueName, payload.idempotencyKey, {
                jobId: job.id,
                contactId: payload.contactId,
                propertiesProcessed: properties.length,
            });
            const processingTime = Date.now() - startTime;
            this.metrics.jobsProcessed++;
            this.metrics.totalProcessingTime += processingTime;
            console.log(`✅ Worker ${this.workerId} completed job ${job.id} ` +
                `in ${(processingTime / 1000).toFixed(2)}s`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ Worker ${this.workerId} failed job ${job.id}:`, errorMessage);
            this.metrics.jobsFailed++;
            const queueName = this.useDailyQueue ? (0, queue_1.getTodayQueueName)() : job.name;
            await (0, idempotency_1.markIdempotencyFailed)(queueName, payload.idempotencyKey, error);
            await prisma.job
                .upsert({
                where: { id: job.id },
                create: {
                    id: job.id,
                    type: job.name,
                    payload: job.data,
                    userId: payload.userId,
                    status: "failed",
                    lastError: errorMessage,
                    attempts: 1,
                },
                update: {
                    status: "failed",
                    lastError: errorMessage,
                },
            })
                .catch((e) => console.error("Failed to update job status:", e));
            throw error;
        }
        finally {
            this.activeJobs--;
            this.emitMetrics();
        }
    }
    async processBatchJob(job) {
        this.activeJobs++;
        const startTime = Date.now();
        const payload = job.data;
        console.log(`👷 Worker ${this.workerId} processing batch job ${job.id} ` +
            `(Batch ${payload.batchIndex + 1}/${payload.totalBatches}) ` +
            `(Active: ${this.activeJobs})`);
        try {
            const existingJob = await prisma.job.findUnique({
                where: { id: job.id },
            });
            if (existingJob) {
                await prisma.job.update({
                    where: { id: job.id },
                    data: {
                        status: "in_progress",
                        startedAt: new Date(),
                        attempts: { increment: 1 },
                    },
                });
            }
            else {
                await prisma.job.create({
                    data: {
                        id: job.id,
                        type: job.name,
                        payload: job.data,
                        userId: payload.userId,
                        status: "in_progress",
                        startedAt: new Date(),
                        attempts: 1,
                    },
                });
            }
            await this.processBatch(payload, job.id);
            await prisma.job.update({
                where: { id: job.id },
                data: {
                    status: "completed",
                    finishedAt: new Date(),
                },
            });
            const processingTime = Date.now() - startTime;
            this.metrics.jobsProcessed++;
            this.metrics.totalProcessingTime += processingTime;
            console.log(`✅ Worker ${this.workerId} completed batch job ${job.id} ` +
                `in ${(processingTime / 1000).toFixed(2)}s`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ Worker ${this.workerId} failed batch job ${job.id}:`, errorMessage);
            this.metrics.jobsFailed++;
            await prisma.job
                .upsert({
                where: { id: job.id },
                create: {
                    id: job.id,
                    type: job.name,
                    payload: job.data,
                    userId: payload.userId,
                    status: "failed",
                    lastError: errorMessage,
                    attempts: 1,
                },
                update: {
                    status: "failed",
                    lastError: errorMessage,
                },
            })
                .catch((e) => console.error("Failed to update job status:", e));
            throw error;
        }
        finally {
            this.activeJobs--;
            this.emitMetrics();
        }
    }
    async processBatch(payload, jobId) {
        const { userId, batchIndex, batchSize, totalBatches } = payload;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { settings: true },
        });
        if (!user?.settings) {
            throw new Error("User or settings not found");
        }
        const offset = batchIndex * batchSize;
        const properties = await prisma.property.findMany({
            where: {
                price: {
                    gte: user.settings.priceMin ?? 0,
                    lte: user.settings.priceMax ?? Number.MAX_SAFE_INTEGER,
                },
                postalCode: { in: user.settings.zipCodes },
                pushed: false,
            },
            include: { owner: true },
            skip: offset,
            take: batchSize,
        });
        console.log(`📦 Worker ${this.workerId} processing batch ${batchIndex + 1}/${totalBatches}: ` +
            `${properties.length} properties (offset: ${offset})`);
        await this.pushPropertiesBatch(properties, user, payload, jobId);
    }
    async pushPropertiesBatch(properties, user, payload, jobId) {
        await (0, jobProgress_1.updateJobProgress)(jobId, {
            processed: payload.batchIndex * payload.batchSize,
            total: payload.totalBatches * payload.batchSize,
            status: `Processing batch ${payload.batchIndex + 1}/${payload.totalBatches}`,
        }).catch((e) => console.log("Failed to update progress:", e));
        const syntheticJob = {
            id: jobId,
            type: queue_1.JOB_TYPES.DELIVER_LEADS_BATCH,
            payload: {
                userId: user.id,
                properties,
            },
            status: "in_progress",
            attempts: 0,
            maxAttempts: 3,
            lastError: null,
            createdAt: new Date(),
            startedAt: new Date(),
            finishedAt: null,
            updatedAt: new Date(),
            userId: user.id,
        };
        await (0, pushLeads_1.pushLeadsForUser)(syntheticJob);
        await (0, jobProgress_1.updateJobProgress)(jobId, {
            processed: (payload.batchIndex + 1) * payload.batchSize,
            total: payload.totalBatches * payload.batchSize,
            status: `Completed batch ${payload.batchIndex + 1}/${payload.totalBatches}`,
        }).catch((e) => console.log("Failed to update progress:", e));
    }
    emitMetrics() {
        this.eventEmitter.emit("jobCompleted", {
            workerId: this.workerId,
            activeJobs: this.activeJobs,
            metrics: this.getMetrics(),
        });
        console.log(`📊 Worker ${this.workerId} - ` +
            `Active: ${this.activeJobs} | ` +
            `Processed: ${this.metrics.jobsProcessed} | ` +
            `Failed: ${this.metrics.jobsFailed} | ` +
            `Avg Time: ${this.getMetrics().averageProcessingTime.toFixed(2)}s`);
    }
    async stop() {
        if (!this.isRunning) {
            return;
        }
        console.log(`🛑 Worker ${this.workerId} stopping...`);
        this.isRunning = false;
        const timeout = 30000;
        const startTime = Date.now();
        while (this.activeJobs > 0 && Date.now() - startTime < timeout) {
            console.log(`⏳ Worker ${this.workerId} waiting for ${this.activeJobs} active jobs...`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (this.activeJobs > 0) {
            console.warn(`⚠️ Worker ${this.workerId} forced shutdown with ${this.activeJobs} active jobs`);
        }
        else {
            console.log(`✅ Worker ${this.workerId} stopped cleanly`);
        }
        console.log(`📊 Final metrics for Worker ${this.workerId}:`, this.getMetrics());
    }
    getStatus() {
        return {
            workerId: this.workerId,
            isRunning: this.isRunning,
            activeJobs: this.activeJobs,
            queueName: this.queueName,
            useDailyQueue: this.useDailyQueue,
            metrics: this.getMetrics(),
        };
    }
    getMetrics() {
        return {
            jobsProcessed: this.metrics.jobsProcessed,
            jobsFailed: this.metrics.jobsFailed,
            totalProcessingTime: this.metrics.totalProcessingTime,
            averageProcessingTime: this.metrics.jobsProcessed > 0
                ? this.metrics.totalProcessingTime / this.metrics.jobsProcessed / 1000
                : 0,
        };
    }
    hasActiveJobs() {
        return this.activeJobs > 0;
    }
    resetMetrics() {
        this.metrics = {
            jobsProcessed: 0,
            jobsFailed: 0,
            totalProcessingTime: 0,
        };
        console.log(`🔄 Worker ${this.workerId} metrics reset`);
    }
}
exports.WorkerManager = WorkerManager;
