import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/ingest-complete';
import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/secureLogger';
import { getQueueInstance } from '@/lib/queue';
// Import the mock instance directly to restore it
import { prisma as mockPrisma } from '../../__mocks__/@prisma/client';

// Mocks
jest.mock('@/lib/apiRateLimiter', () => ({
    withRateLimit: (fn: any) => fn,
}));

// Use manual mock from src/lib/__mocks__/secureLogger.ts
jest.mock('@/lib/secureLogger');

jest.mock('@/lib/queue', () => ({
    getQueueInstance: jest.fn(),
    JOB_TYPES: {
        DELIVER_LEADS_BATCH: 'deliver-leads-batch',
    },
}));

// Use manual mock from __mocks__/@prisma/client.ts
jest.mock('@prisma/client');

describe('Webhook Security', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        process.env.WEBHOOK_SECRET = 'valid-secret';
        jest.clearAllMocks();

        // Restore mock implementations wiped by resetMocks: true
        (logger.withCorrelationId as jest.Mock).mockReturnValue(logger);

        // Restore getQueueInstance mock
        (getQueueInstance as jest.Mock).mockResolvedValue({
            createQueue: jest.fn().mockResolvedValue(undefined),
            send: jest.fn().mockResolvedValue('job-id'),
        });

        // Restore Prisma constructor (IMPORTANT: resetMocks wipes this too)
        (PrismaClient as unknown as jest.Mock).mockImplementation(() => mockPrisma);

        // Restore Prisma mocks
        (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([]);
        (mockPrisma.property.count as jest.Mock).mockResolvedValue(0);
        (mockPrisma.webhookLog.create as jest.Mock).mockResolvedValue({});
        (mockPrisma.job.create as jest.Mock).mockResolvedValue({});
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('should reject requests without x-hook-secret header (401)', async () => {
        const { req, res } = createMocks({
            method: 'POST',
            body: {
                runId: 'test-run',
                ingestedAt: new Date().toISOString(),
            },
        });

        await handler(req, res);

        expect(res._getStatusCode()).toBe(401);
        expect(res._getJSONData()).toEqual({ error: 'Unauthorized' });
    });

    test('should reject requests with invalid x-hook-secret header (401)', async () => {
        const { req, res } = createMocks({
            method: 'POST',
            headers: {
                'x-hook-secret': 'invalid-secret',
            },
            body: {
                runId: 'test-run',
                ingestedAt: new Date().toISOString(),
            },
        });

        await handler(req, res);

        expect(res._getStatusCode()).toBe(401);
        expect(res._getJSONData()).toEqual({ error: 'Unauthorized' });
    });

    test('should reject non-POST requests (405)', async () => {
        const { req, res } = createMocks({
            method: 'GET',
            headers: {
                'x-hook-secret': 'valid-secret',
            },
        });

        await handler(req, res);

        expect(res._getStatusCode()).toBe(405);
        expect(res._getJSONData()).toEqual({ error: 'Method not allowed' });
    });

    test('should accept requests with valid x-hook-secret header (200)', async () => {
        const { req, res } = createMocks({
            method: 'POST',
            headers: {
                'x-hook-secret': 'valid-secret',
            },
            body: {
                runId: 'test-run',
                ingestedAt: new Date().toISOString(),
            },
        });

        await handler(req, res);

        expect(res._getStatusCode()).toBe(200);
        expect(res._getJSONData()).toMatchObject({
            success: true,
            runId: 'test-run',
        });
    });

    test('should validate payload format (400 for bad payload)', async () => {
        const { req, res } = createMocks({
            method: 'POST',
            headers: {
                'x-hook-secret': 'valid-secret',
            },
            body: {
                ingestedAt: 'not-a-date',
            },
        });

        await handler(req, res);

        expect(res._getStatusCode()).toBe(400);
        expect(res._getJSONData()).toMatchObject({
            error: 'Invalid payload format',
        });
    });
});
