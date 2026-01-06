// src/pages/api/health.ts
// IMPORTANT-5: Health check endpoint for load balancers and orchestrators

import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';

interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
        database: boolean;
    };
    timestamp: string;
    error?: string;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<HealthStatus>
) {
    const checks = {
        database: false,
    };

    try {
        // Check database connectivity
        await prisma.$queryRaw`SELECT 1`;
        checks.database = true;

        res.status(200).json({
            status: 'healthy',
            checks,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            checks,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}
