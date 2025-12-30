// tests/jobs/provisionDailyQueues.test.ts
import { provisionDailyQueues } from '@/jobs/provisionDailyQueues';
import { PrismaClient } from '@prisma/client';
import { getQueueInstance, closeQueue } from '@/lib/queue';

const prisma = new PrismaClient();

describe('Daily Queue Provisioning', () => {
    // Setup: Ensure we have a clean state and queue connection
    beforeAll(async () => {
        // Ensure queue is ready
        await getQueueInstance();
    }, 60000);

    beforeEach(async () => {
        // Clean specific tables in order to respect foreign keys
        await prisma.jobIdempotency.deleteMany();
        await prisma.job.deleteMany();
        await prisma.property.deleteMany();
        await prisma.contact.deleteMany();
        await prisma.userSettings.deleteMany();
        await prisma.account.deleteMany();
        await prisma.session.deleteMany();
        await prisma.user.deleteMany();

        // Clean ingestion-related tables
        await prisma.processedFile.deleteMany();
        await prisma.webhookLog.deleteMany();
        await prisma.ingestionRun.deleteMany();

        // Also ensure an IngestionRun exists so checkDataReady passes
        await prisma.ingestionRun.create({
            data: {
                status: "completed",
                startedAt: new Date(),
            }
        });
    }, 60000);

    afterAll(async () => {
        await closeQueue();
        await prisma.$disconnect();
    });

    test('provisions jobs for users with matching properties', async () => {
        // Create test user with settings
        const user = await prisma.user.create({
            data: {
                email: 'test@example.com',
                name: 'Test User',
                password: 'hash', // Added password as it might be required by schema
                settings: {
                    create: {
                        zipCodes: ['10001', '10002'],
                        radiusMiles: 10,
                        priceMin: 100000,
                        priceMax: 500000,
                        planLimit: 10,
                    },
                },
            },
        });

        // Create test contact
        const contact = await prisma.contact.create({
            data: {
                contactId: "101", // Corrected to string to match schema
                email: 'owner@example.com',
                firstName: 'John',
                lastName: 'Doe',
            },
        });

        // Create test properties
        await prisma.property.createMany({
            data: [
                {
                    ownerId: contact.id, // Using the internal ID
                    postalCode: '10001',
                    price: 250000,
                    addressFull: '123 Main St',
                    pushed: false,

                },
                {
                    ownerId: contact.id,
                    postalCode: '10002',
                    price: 300000,
                    addressFull: '456 Oak Ave',
                    pushed: false,
                },
            ],
        });

        // Run provisioning
        const result = await provisionDailyQueues({ dryRun: false });

        expect(result.success).toBe(true);
        // jobsCreated might depend on grouping. 2 properties for same contact = 1 job?
        // provisionDailyQueues.ts groups by contact.
        // "Create one job per contact (with their properties)"
        // So if both properties belong to same contact, 1 job.
        expect(result.jobsCreated).toBeGreaterThan(0);
        expect(result.contactsProcessed).toBe(1);
        expect(result.propertiesProcessed).toBe(2);

        // Verify jobs created in database
        const jobs = await prisma.job.findMany({
            where: { userId: user.id },
        });
        expect(jobs.length).toBeGreaterThan(0);
    }, 60000);

    test('respects plan limit', async () => {
        // Clean for this specific test

        const user = await prisma.user.create({
            data: {
                email: 'limit@example.com',
                password: 'hash',
                settings: {
                    create: {
                        zipCodes: ['10001'],
                        radiusMiles: 10,
                        priceMin: 0,
                        priceMax: 1000000,
                        planLimit: 5, // Limit to 5
                    },
                },
            },
        });

        const contact = await prisma.contact.create({
            data: { contactId: "102", email: 'owner2@test.com' },
        });

        // Create 10 properties
        const propertiesData = Array.from({ length: 10 }, (_, i) => ({
            ownerId: contact.id,
            postalCode: '10001',
            price: 100000 + i * 1000,
            addressFull: `${i} Main St`,
            pushed: false,
        }));

        await prisma.property.createMany({
            data: propertiesData,
        });

        const result = await provisionDailyQueues({ dryRun: false });

        // Should only process 5 properties due to plan limit
        expect(result.propertiesProcessed).toBe(5);

        // Check pushed flag? provisionDailyQueues doesn't seem to mark them as pushed in the snippet I saw?
        // Wait, let's re-read provisionDailyQueues.ts.
        // It creates jobs. It doesn't seem to update `property.pushed` to true immediately?
        // ACTUALLY: The snippet I saw:
        // "Create corresponding database record ... await prisma.job.create ..."
        // It does NOT update `property.pushed = true`. 
        // It seems the worker does that later? Or `checkDataReady`?
        // The test says "respects plan limit". It does `getPropertiesPushedToday`.
        // It queries `pushed: false`.
        // Then it takes `remainingLimit`.
        // `take: remainingLimit`.
        // So it processes at most N properties.
        // So result.propertiesProcessed should be 5. Correct.
    }, 60000);

    test('dry run mode does not create jobs', async () => {
        const user = await prisma.user.create({
            data: {
                email: 'dryrun@example.com',
                password: 'hash',
                settings: {
                    create: {
                        zipCodes: ['10001'],
                        radiusMiles: 10,
                        priceMin: 0,
                        priceMax: 1000000,
                        planLimit: 10,
                    },
                },
            },
        });

        const contact = await prisma.contact.create({
            data: { contactId: "103", email: 'owner3@test.com' },
        });

        await prisma.property.create({
            data: {
                ownerId: contact.id,
                postalCode: '10001',
                price: 250000,
                addressFull: '123 Main St',
                pushed: false,
            },
        });

        const result = await provisionDailyQueues({ dryRun: true });

        expect(result.success).toBe(true);
        expect(result.jobsCreated).toBe(0);

        const jobs = await prisma.job.findMany();
        expect(jobs.length).toBe(0);
    }, 60000);
});
