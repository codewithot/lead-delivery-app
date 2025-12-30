// tests/lib/idempotency.test.ts
import { checkAndClaimIdempotency, markIdempotencyCompleted, generateIdempotencyKey } from '@/lib/idempotency';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Idempotency', () => {
    beforeEach(async () => {
        // Clean up before each test
        await prisma.jobIdempotency.deleteMany();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    test('checkAndClaimIdempotency allows first job', async () => {
        const result = await checkAndClaimIdempotency(
            'leads:assign:20250115',
            'contact-123:20250115',
            'job-abc'
        );

        expect(result.shouldProcess).toBe(true);
        expect(result.existingJobId).toBeUndefined();
    });

    test('checkAndClaimIdempotency blocks duplicate job', async () => {
        // First call
        await checkAndClaimIdempotency(
            'leads:assign:20250115',
            'contact-123:20250115',
            'job-abc'
        );

        // Second call with same key
        const result = await checkAndClaimIdempotency(
            'leads:assign:20250115',
            'contact-123:20250115',
            'job-xyz'
        );

        expect(result.shouldProcess).toBe(false);
        expect(result.existingJobId).toBe('job-abc');
    });

    test('generateIdempotencyKey formats correctly', () => {
        const key = generateIdempotencyKey('contact', 456, '20250115');
        expect(key).toBe('contact-456:20250115');
    });

    test('markIdempotencyCompleted updates status', async () => {
        await checkAndClaimIdempotency(
            'leads:assign:20250115',
            'contact-123:20250115',
            'job-abc'
        );

        await markIdempotencyCompleted(
            'leads:assign:20250115',
            'contact-123:20250115',
            { success: true }
        );

        const record = await prisma.jobIdempotency.findUnique({
            where: {
                queueName_idempotencyKey: {
                    queueName: 'leads:assign:20250115',
                    idempotencyKey: 'contact-123:20250115',
                },
            },
        });

        expect(record?.status).toBe('completed');
        expect(record?.completedAt).toBeTruthy();
    });
});
