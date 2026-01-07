#!/usr/bin/env tsx
/**
 * Dev Utilities - Consolidated development and debugging scripts
 * 
 * Usage: npx tsx scripts/dev-utils.ts <command> [options]
 * 
 * Commands:
 *   jobs:status          - Check status of jobs (pg-boss and app)
 *   jobs:list            - List all pg-boss jobs by name and state
 *   jobs:reset           - Reset failed/stuck jobs to pending
 *   properties:list      - List all properties with push status
 *   properties:debug     - Debug property matching for a specific user
 *   redis:clear          - Clear Redis rate limiter keys
 *   queue:provision      - Manually trigger queue provisioning
 *   tokens:check         - Check GHL tokens for a user
 *   tokens:clear         - Clear GHL tokens for a user (force re-auth)
 *   schema:check         - Check pg-boss schema
 *   data:backfill        - Backfill normalized address fields
 *   data:fix-duplicates  - Fix duplicate properties
 */

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { provisionWithRetry } from '@/jobs/provisionDailyQueues';

const prisma = new PrismaClient();

// ============================================================================
// JOB UTILITIES
// ============================================================================

async function checkJobStatus() {
    console.log('🔍 Checking Job Status...\\n');

    // 1. Check pg-boss job states
    const pgBossStats = await prisma.$queryRawUnsafe(`
      SELECT state, count(*) as count, min(created_on) as earliest, max(created_on) as latest
      FROM pgboss.job 
      WHERE name LIKE 'leads_assign%' OR name = 'deliver-leads-batch'
      GROUP BY state
    `);
    console.log('📊 pg-boss (internal queue):');
    console.table(pgBossStats);

    // 2. Check Application Job table states
    const jobStats = await prisma.job.groupBy({
        by: ['status'],
        _count: true,
    });
    console.log('\\nApp Jobs Table:');
    console.table(jobStats.map(s => ({ status: s.status, count: s._count })));
}

async function listPgBossJobs() {
    console.log('📋 Listing pg-boss jobs...\\n');

    const allJobs = await prisma.$queryRaw`
        SELECT name, state, COUNT(*) as count 
        FROM pgboss.job 
        GROUP BY name, state
        ORDER BY name, state
    `;
    console.log('All jobs by name and state:');
    console.table(allJobs);

    // Get sample of recent jobs
    const sampleJobs = await prisma.$queryRaw`
        SELECT id, name, state, created_on, start_after
        FROM pgboss.job 
        ORDER BY created_on DESC
        LIMIT 10
    `;
    console.log('\\nRecent jobs (limit 10):');
    console.table(sampleJobs);
}

async function resetFailedJobs() {
    console.log('🔄 Resetting failed jobs...\\n');

    // 1. Reset pg-boss jobs
    console.log('📋 Step 1: Resetting pg-boss job queue...');
    const pgBossResult = await prisma.$executeRawUnsafe(`
        UPDATE pgboss.job 
        SET 
          state = 'created',
          retry_count = 0,
          retry_delay = 60,
          retry_limit = 3,
          start_after = NOW(),
          completed_on = NULL,
          output = NULL,
          started_on = NULL
        WHERE 
          (name = 'deliver-leads-batch' OR name LIKE 'leads_assign%')
          AND state IN ('failed', 'active', 'completed', 'cancelled')
    `);
    console.log(`   ✅ Reset ${pgBossResult} jobs in pg-boss queue\\n`);

    // 2. Reset Job table
    console.log('📋 Step 2: Resetting Job table...');
    const jobResult = await prisma.job.updateMany({
        where: {
            status: { in: ['failed', 'in_progress', 'completed', 'cancelled'] }
        },
        data: {
            status: 'pending',
            attempts: 0,
            lastError: null,
            startedAt: null,
            finishedAt: null
        }
    });
    console.log(`   ✅ Reset ${jobResult.count} jobs in Job table\\n`);

    console.log('✅ All jobs have been reset to pending!');
    console.log('🎯 Workers should pick them up shortly!\\n');
}

async function purgeAllJobs() {
    console.log('🗑️  PURGING all jobs from pg-boss and Job table...\\n');
    console.log('⚠️  This will permanently DELETE all jobs!\\n');

    // 1. Delete all pg-boss jobs
    console.log('📋 Step 1: Deleting ALL pg-boss jobs...');
    const pgBossDeleteResult = await prisma.$executeRawUnsafe(`
        DELETE FROM pgboss.job 
        WHERE name = 'deliver-leads-batch' 
           OR name LIKE 'leads_assign%'
    `);
    console.log(`   ✅ Deleted ${pgBossDeleteResult} jobs from pg-boss queue\\n`);

    // 2. Also clean up archive table (may not exist in all pg-boss versions)
    console.log('📋 Step 2: Cleaning pg-boss archive...');
    try {
        const archiveResult = await prisma.$executeRawUnsafe(`
            DELETE FROM pgboss.archive 
            WHERE name = 'deliver-leads-batch' 
               OR name LIKE 'leads_assign%'
        `);
        console.log(`   ✅ Cleaned ${archiveResult} jobs from pg-boss archive\\n`);
    } catch {
        console.log('   ⏭️  Archive table does not exist, skipping...\\n');
    }

    // 3. Delete all Job table entries
    console.log('📋 Step 3: Deleting ALL jobs from Job table...');
    const jobDeleteResult = await prisma.job.deleteMany({});
    console.log(`   ✅ Deleted ${jobDeleteResult.count} jobs from Job table\\n`);

    console.log('✅ All jobs have been PURGED!');
    console.log('🎯 Fresh start - no pending jobs.\\n');
}

// ============================================================================
// PROPERTY UTILITIES
// ============================================================================

async function listAllProperties() {
    console.log('📋 Listing ALL properties...\\n');

    const allProps = await prisma.property.findMany({
        select: {
            id: true,
            postalCode: true,
            price: true,
            pushed: true,
            pushedAt: true,
            ghlPropertyId: true,
            createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 50 // Limit to recent 50
    });

    console.table(allProps);
    console.log(`\\nShowing most recent 50 properties`);

    // Group by pushed status
    const total = await prisma.property.count();
    const pushed = await prisma.property.count({ where: { pushed: true } });
    const unpushed = total - pushed;

    console.log('\\nTotal breakdown:');
    console.table({
        'TOTAL': total,
        'PUSHED': pushed,
        'UNPUSHED': unpushed
    });
}

// ============================================================================
// REDIS UTILITIES
// ============================================================================

async function clearRedisRateLimiter() {
    console.log('🧹 Clearing Redis rate limiter state...\\n');

    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
    });

    try {
        const keys = await redis.keys('ghl-rate-limiter*');
        console.log(`📋 Found ${keys.length} rate limiter keys`);

        if (keys.length > 0) {
            console.log('   Keys:', keys);
            await redis.del(...keys);
            console.log(`✅ Deleted ${keys.length} keys\\n`);
        } else {
            console.log('ℹ️  No rate limiter keys found (already clean)\\n');
        }

        console.log('✅ Rate limiter state cleared!');
        console.log('🔄 Please restart your workers now.\\n');
    } finally {
        await redis.quit();
    }
}

// ============================================================================
// QUEUE UTILITIES
// ============================================================================

async function provisionQueues() {
    console.log("🎯 Manual queue provision triggered\\n");
    await provisionWithRetry();
    console.log("\\n✅ Manual provision complete");
}

// ============================================================================
// PROPERTY DEBUG UTILITIES
// ============================================================================

async function debugPropertyMatching() {
    const email = process.argv[3] || 'victoryikuomola@gmail.com';
    console.log(`🔍 Debugging property matching for: ${email}\\n`);

    const user = await prisma.user.findUnique({
        where: { email },
        include: { settings: true }
    });

    if (!user || !user.settings) {
        console.error('❌ User or settings not found');
        return;
    }

    console.log('👤 User Settings:');
    console.log(JSON.stringify(user.settings, null, 2));

    const totalUnpushed = await prisma.property.count({
        where: { pushed: false }
    });
    console.log(`\\n🏠 Total unpushed properties: ${totalUnpushed}`);

    const matches = await prisma.property.findMany({
        where: {
            price: {
                gte: user.settings.priceMin ?? 0,
                lte: user.settings.priceMax ?? Number.MAX_SAFE_INTEGER,
            },
            postalCode: { in: user.settings.zipCodes },
            pushed: false,
        },
        take: 10
    });

    console.log(`\\n✅ Matches found: ${matches.length}`);
    if (matches.length > 0) {
        console.table(matches.map(m => ({
            id: m.id,
            price: m.price,
            zip: m.postalCode,
            pushed: m.pushed
        })));
    }
}

// ============================================================================
// TOKEN UTILITIES
// ============================================================================

async function checkTokens() {
    const email = process.argv[3] || 'victoryikuomola@gmail.com';
    console.log(`\\n🔍 Checking tokens for: ${email}\\n`);

    const user = await prisma.user.findUnique({
        where: { email },
        select: {
            accessToken: true,
            refreshToken: true,
            tokenExpiresAt: true,
            locationId: true,
        },
    });

    if (!user) {
        console.log('❌ User not found!');
        return;
    }

    console.log('Current status:');
    console.log(`  - Has accessToken: ${!!user.accessToken}`);
    console.log(`  - Has refreshToken: ${!!user.refreshToken}`);
    console.log(`  - Has locationId: ${!!user.locationId}`);
    console.log(`  - Token expires: ${user.tokenExpiresAt}\\n`);
}

async function clearTokens() {
    const email = process.argv[3] || 'victoryikuomola@gmail.com';
    console.log(`\\n🧹 Clearing tokens for: ${email}\\n`);

    await prisma.user.update({
        where: { email },
        data: {
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
        },
    });

    console.log('✅ Tokens cleared!');
    console.log('📱 User will see re-auth prompt on next dashboard visit\\n');
}

// ============================================================================
// SCHEMA UTILITIES
// ============================================================================

async function checkSchema() {
    console.log('🔍 Checking pg-boss schema...\\n');

    const columns = await prisma.$queryRaw`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'pgboss' 
        AND table_name = 'job' 
        ORDER BY ordinal_position
    `;

    console.log('pg-boss job table columns:');
    console.table(columns);
}

// ============================================================================
// DATA UTILITIES
// ============================================================================

async function backfillData() {
    console.log('� Database statistics...\\n');

    const total = await prisma.property.count();
    const pushed = await prisma.property.count({ where: { pushed: true } });
    const withGhlId = await prisma.property.count({ where: { ghlPropertyId: { not: null } } });

    console.table({
        'Total Properties': total,
        'Pushed': pushed,
        'Unpushed': total - pushed,
        'With GHL ID': withGhlId
    });

    console.log('\\n✅ Database stats shown\\n');
}

async function fixDuplicates() {
    console.log('🔄 Finding and fixing duplicate properties...\\n');

    // Find duplicates by address
    const duplicates = await prisma.$queryRaw<any[]>`
        SELECT "addressFull", COUNT(*) as count
        FROM "Property"
        WHERE "addressFull" IS NOT NULL
        GROUP BY "addressFull"
        HAVING COUNT(*) > 1
        LIMIT 10
    `;

    console.log(`Found ${duplicates.length} duplicate addresses`);
    console.table(duplicates);

    if (duplicates.length > 0) {
        console.log('\\n⚠️  Run data:fix-duplicates:confirm to actually delete duplicates');
    }
}

// ============================================================================
// MAIN CLI
// ============================================================================

async function main() {
    const command = process.argv[2];

    try {
        switch (command) {
            case 'jobs:status':
                await checkJobStatus();
                break;
            case 'jobs:list':
                await listPgBossJobs();
                break;
            case 'jobs:reset':
                await resetFailedJobs();
                break;
            case 'properties:list':
                await listAllProperties();
                break;
            case 'properties:debug':
                await debugPropertyMatching();
                break;
            case 'redis:clear':
                await clearRedisRateLimiter();
                break;
            case 'queue:provision':
                await provisionQueues();
                break;
            case 'tokens:check':
                await checkTokens();
                break;
            case 'tokens:clear':
                await clearTokens();
                break;
            case 'schema:check':
                await checkSchema();
                break;
            case 'data:stats':
                await backfillData();
                break;
            case 'data:duplicates':
                await fixDuplicates();
                break;
            case 'jobs:purge':
                await purgeAllJobs();
                break;
            default:
                console.log(`
❌ Unknown command: ${command || '(none)'}

📖 Usage: npx tsx scripts/dev-utils.ts <command> [email]

Available commands:
  jobs:status          - Check status of jobs (pg-boss and app)
  jobs:list            - List all pg-boss jobs by name and state
  jobs:reset           - Reset failed/stuck jobs to pending
  jobs:purge           - ⚠️  DELETE all jobs from pg-boss and Job table
  properties:list      - List all properties with push status
  properties:debug     - Debug property matching for a user (optional: email)
  redis:clear          - Clear Redis rate limiter keys
  queue:provision      - Manually trigger queue provisioning
  tokens:check         - Check GHL tokens for a user (optional: email)
  tokens:clear         - Clear GHL tokens to force re-auth (optional: email)
  schema:check         - Check pg-boss database schema
  data:stats           - Show database statistics
  data:duplicates      - Find duplicate properties

Examples:
  npx tsx scripts/dev-utils.ts jobs:status
  npx tsx scripts/dev-utils.ts jobs:purge
  npx tsx scripts/dev-utils.ts tokens:clear user@example.com
                `);
                process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

main();
