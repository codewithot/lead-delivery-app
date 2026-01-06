// src/pages/api/auth/check-tokens.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { prisma } from '@/lib/prisma';

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const session = await getServerSession(req, res, authOptions);

    if (!session?.user?.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: session.user.userId },
            select: {
                accessToken: true,
                refreshToken: true,
                tokenExpiresAt: true,
                locationId: true,
            },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const hasTokens = !!(user.accessToken && user.refreshToken);
        const hasLocationId = !!user.locationId;

        return res.status(200).json({
            hasTokens,
            hasLocationId,
            needsReauth: !hasTokens || !hasLocationId,
        });
    } catch (error) {
        console.error('Error checking tokens:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
