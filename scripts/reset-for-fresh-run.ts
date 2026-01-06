// reset-for-fresh-run.ts - Reset contacts and properties to be re-processed by workers
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetForFreshRun() {
    console.log('🔄 Resetting data for fresh worker run...\n');

    // Reset all contacts
    const contactsReset = await prisma.contact.updateMany({
        where: { pushed: true },
        data: {
            pushed: false,
            ghlContactId: null
        }
    });
    console.log(`✅ Reset ${contactsReset.count} contacts (pushed: false, ghlContactId: null)`);

    // Reset all properties
    const propertiesReset = await prisma.property.updateMany({
        where: { pushed: true },
        data: {
            pushed: false,
            pushedAt: null,
            ghlPropertyId: null
        }
    });
    console.log(`✅ Reset ${propertiesReset.count} properties (pushed: false, ghlPropertyId: null)`);

    // Reset jobs in pg-boss (using actual column names from schema check)
    const pgbossReset = await prisma.$executeRaw`
    UPDATE pgboss.job 
    SET state = 'created', 
        retry_count = 0, 
        retry_limit = 5,
        retry_delay = 0,
        start_after = NOW(),
        started_on = NULL,
        completed_on = NULL,
        output = NULL
    WHERE name LIKE 'leads_assign%' 
    AND state IN ('completed', 'failed', 'cancelled', 'active')
  `;
    console.log(`✅ Reset ${pgbossReset} jobs in pg-boss queue`);

    // Reset jobs in Job table (using correct field: lastError not error)
    const jobsReset = await prisma.job.updateMany({
        where: { status: { in: ['completed', 'failed', 'in_progress'] } },
        data: {
            status: 'pending',
            lastError: null,
            attempts: 0,
            startedAt: null,
            finishedAt: null
        }
    });
    console.log(`✅ Reset ${jobsReset.count} jobs in Job table`);

    console.log('\n🎯 Ready for fresh run! Start workers with: npm run workers');

    await prisma.$disconnect();
}

resetForFreshRun().catch(console.error);
