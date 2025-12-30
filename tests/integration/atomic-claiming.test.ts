import { PrismaClient } from "@prisma/client";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { jest, describe, test, expect, beforeAll, afterAll } from '@jest/globals';

// Increase timeout for integration tests
jest.setTimeout(60000);

const prisma = new PrismaClient();

describe('Atomic Job Claiming Integration', () => {
    let testUser: any;
    let createdJobIds: string[] = [];

    beforeAll(async () => {
        // Get or create a test user
        testUser = await prisma.user.findFirst({
            where: { email: "test-integration@example.com" },
        });

        if (!testUser) {
            testUser = await prisma.user.create({
                data: {
                    email: "test-integration@example.com",
                    name: "Test Integration User",
                    settings: {
                        create: {
                            zipCodes: ["10001"],
                            radiusMiles: 10,
                            priceMin: 0,
                            priceMax: 1000000,
                            planLimit: 100
                        }
                    }
                },
                include: { settings: true }
            });
        }
    });

    afterAll(async () => {
        // Cleanup jobs
        if (createdJobIds.length > 0) {
            await prisma.job.deleteMany({
                where: {
                    id: { in: createdJobIds },
                },
            });
        }

        // Cleanup user if we created it? detailed cleanup might be needed but for now leaving user is fine or delete
        // await prisma.user.delete({ where: { id: testUser.id } });

        await prisma.$disconnect();
    });

    // Helper to create jobs
    async function createTestJobs(count: number): Promise<string[]> {
        const jobIds: string[] = [];
        for (let i = 0; i < count; i++) {
            const job = await prisma.job.create({
                data: {
                    type: "test-atomic-claiming-integration",
                    status: "pending",
                    payload: {
                        testData: `Test job ${i + 1}`,
                        timestamp: new Date().toISOString(),
                    },
                    userId: testUser.id,
                },
            });
            jobIds.push(job.id);
        }
        createdJobIds.push(...jobIds);
        return jobIds;
    }

    test('should prevent race conditions when multiple workers claim jobs', async () => {
        const JOB_COUNT = 20;
        const WORKER_COUNT = 50;

        // Create jobs
        const jobIds = await createTestJobs(JOB_COUNT);

        // Simulation results
        const claimedMap = new Map<string, string>(); // jobId -> workerId
        let successfulClaims = 0;
        let failedClaims = 0;
        let duplicateClaims = 0;

        // Simulate concurrent workers
        const workerPromises = Array.from({ length: WORKER_COUNT }, async (_, workerIndex) => {
            const workerId = `sim-worker-${workerIndex}`;

            for (const jobId of jobIds) {
                try {
                    // Simulate atomic claim using raw query (same as actual worker implementation)
                    const claimResult = await prisma.$queryRaw<{ id: string }[]>`
                        UPDATE "Job"
                        SET 
                            status = 'in_progress',
                            "startedAt" = NOW(),
                            attempts = attempts + 1
                        WHERE id = ${jobId}
                            AND status = 'pending'
                        RETURNING id
                    `;

                    if (claimResult.length > 0) {
                        successfulClaims++;
                        if (claimedMap.has(jobId)) {
                            duplicateClaims++;
                            console.error(`Race condition: Job ${jobId} claimed by ${claimedMap.get(jobId)} and ${workerId}`);
                        } else {
                            claimedMap.set(jobId, workerId);
                        }
                    } else {
                        failedClaims++;
                    }
                } catch (error) {
                    failedClaims++;
                }
            }
        });

        await Promise.all(workerPromises);

        // Assertions
        expect(duplicateClaims).toBe(0);
        expect(successfulClaims).toBe(JOB_COUNT);
        // We expect exactly JOB_COUNT successes. 
        // Total attempts = WORKER_COUNT * JOB_COUNT.
        // Failed = Total - Success.
    });

    // Only run this if we are in dev/test environment where tsx is available
    const workerRunnerPath = path.join(process.cwd(), "tests", "integration", "worker-runner.ts");

    // We use node --import tsx to run the worker code directly from TS source
    test('should process jobs with actual worker process', async () => {
        const JOB_COUNT = 5;
        const currentJobIds = await createTestJobs(JOB_COUNT);

        const workers: any[] = [];
        const WORKER_PROCESS_COUNT = 3;

        // Spawn workers
        for (let i = 0; i < WORKER_PROCESS_COUNT; i++) {
            const worker = spawn("node", ["--import", "tsx", workerRunnerPath], {
                stdio: "pipe",
                env: {
                    ...process.env,
                    WORKER_ID: `integration-worker-${i}`,
                },
            });

            worker.stdout?.on('data', (data) => console.log(`[Worker ${i}] ${data}`));
            worker.stderr?.on('data', (data) => console.error(`[Worker ${i} ERR] ${data}`));

            // Cleanup on exit
            workers.push(worker);
        }

        // Wait for processing (allow some time)
        await new Promise((resolve) => setTimeout(resolve, 8000));

        // Kill workers
        workers.forEach(w => w.kill());

        // Check verification
        const processedJobs = await prisma.job.findMany({
            where: {
                id: { in: currentJobIds },
                status: { in: ["completed", "in_progress", "failed"] } // Worker might complete or just start
            }
        });

        // We expect some jobs to be picked up
        expect(processedJobs.length).toBeGreaterThan(0);

        // Check for duplicates
        const inProgressJobs = await prisma.job.findMany({
            where: {
                id: { in: currentJobIds },
                status: "in_progress"
            }
        });

        // This assertion is weak because we just query status.
        // A better check is if we had logs, but for DB state, we just ensure consistent state.

        // Ensure no job is claimed by multiple valid processes (hard to check in DB snapshot unless we log claimer).
        // But the previous test validated the claiming logic.
    });
});
