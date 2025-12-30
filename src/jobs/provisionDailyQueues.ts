// src/jobs/provisionDailyQueues.ts
import { PrismaClient, Prisma, UserSettings } from "@prisma/client";
import {
  getQueueInstance,
  JOB_TYPES,
  getDailyQueueName,
  DailyLeadAssignmentPayload,
} from "../lib/queue";
import {
  todayYYYYMMDD,
  getRegionTimezone,
  formatForLog,
  getProvisionTimes,
} from "../lib/timezone";
import { generateIdempotencyKey } from "../lib/idempotency";
import { DateTime } from "luxon";
import { createLogger, generateCorrelationId } from "@/lib/secureLogger";

const logger = createLogger('ProvisionQueues');

const prisma = new PrismaClient();

interface ProvisionOptions {
  dryRun?: boolean;
  forceDate?: string; // For testing: override date
  batchSize?: number; // Number of leads per batch
  maxRetries?: number; // For provisionWithRetry: number of retry attempts (default: 3)
}

interface ProvisionResult {
  success: boolean;
  date: string;
  queueName: string;
  jobsCreated: number;
  contactsProcessed: number;
  propertiesProcessed: number;
  error?: string;
  timestamp: string;
}

/**
 * Helper: Convert YYYYMMDD string to DateTime
 */
function dateTimeFromYYYYMMDD(date: string): DateTime {
  const year = date.slice(0, 4);
  const month = date.slice(4, 6);
  const day = date.slice(6, 8);
  return DateTime.fromISO(`${year}-${month}-${day}`, {
    zone: getRegionTimezone(),
  });
}

/**
 * Check if properties were pushed earlier today
 * This prevents counting properties from previous days
 */
async function getPropertiesPushedToday(
  userId: string,
  settings: UserSettings,
  date: string
): Promise<number> {
  const startOfDay = dateTimeFromYYYYMMDD(date).startOf("day").toJSDate();
  const endOfDay = dateTimeFromYYYYMMDD(date).endOf("day").toJSDate();

  const count = await prisma.property.count({
    where: {
      price: {
        gte: settings.priceMin ?? 0,
        lte: settings.priceMax ?? Number.MAX_SAFE_INTEGER,
      },
      postalCode: { in: settings.zipCodes },
      pushed: true,
      pushedAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  return count;
}

/**
 * Main provision function - creates daily queue and enqueues jobs
 */
export async function provisionDailyQueues(
  options: ProvisionOptions = {}
): Promise<ProvisionResult> {
  const startTime = DateTime.now().setZone(getRegionTimezone());
  const date = options.forceDate || todayYYYYMMDD();
  const queueName = getDailyQueueName(JOB_TYPES.DAILY_LEAD_ASSIGNMENT, date);

  // Generate correlation ID for this provision run
  const correlationId = generateCorrelationId('provision', date);
  const scopedLogger = logger.withCorrelationId(correlationId);

  scopedLogger.info('Provisioning daily queue started', {
    queueName,
    startTime: formatForLog(startTime),
    timezone: getRegionTimezone()
  });

  const result: ProvisionResult = {
    success: false,
    date,
    queueName,
    jobsCreated: 0,
    contactsProcessed: 0,
    propertiesProcessed: 0,
    timestamp: startTime.toISO()!,
  };

  try {
    // Step 1: Check if data is ready
    const dataReady = await checkDataReady(date);
    if (!dataReady) {
      const error = "Data not ready for ingestion";
      scopedLogger.warn(error);
      result.error = error;
      return result;
    }

    // Step 2: Get queue instance and create queue
    const boss = await getQueueInstance();

    if (!options.dryRun) {
      try {
        await boss.createQueue(queueName);
        scopedLogger.info('Queue created/verified', { queueName });
      } catch (error) {
        scopedLogger.info('Queue already exists', { queueName });
        scopedLogger.debug('Queue creation error', error);
      }
    }

    // Step 3: Fetch all users with settings
    const users = await prisma.user.findMany({
      where: {
        settings: {
          isNot: null,
        },
      },
      include: {
        settings: true,
      },
    });

    scopedLogger.info('Found users with settings', { userCount: users.length });

    // Step 4: For each user, fetch matching properties and create jobs
    for (const user of users) {
      if (!user.settings) continue;

      logger.info("Processing user", { userId: user.id });

      // ✅ NEW: Check how many properties already pushed today
      const alreadyPushedCount = await getPropertiesPushedToday(
        user.id,
        user.settings,
        date
      );

      const remainingLimit = Math.max(
        0,
        user.settings.planLimit - alreadyPushedCount
      );

      if (remainingLimit === 0) {
        scopedLogger.info('Plan limit reached, skipping user', {
          userId: user.id,
          planLimit: user.settings.planLimit
        });
        continue;
      }

      scopedLogger.info('Plan limits for user', {
        userId: user.id,
        planLimit: user.settings.planLimit,
        alreadyPushed: alreadyPushedCount,
        remaining: remainingLimit
      });

      // Fetch properties that match user's criteria and haven't been pushed
      const properties = await prisma.property.findMany({
        where: {
          price: {
            gte: user.settings.priceMin ?? 0,
            lte: user.settings.priceMax ?? Number.MAX_SAFE_INTEGER,
          },
          postalCode: { in: user.settings.zipCodes },
          pushed: false,
        },
        include: {
          owner: true,
        },
        take: remainingLimit, // ✅ Use remaining limit, not full plan limit
        orderBy: {
          createdAt: "asc", // ✅ FIFO ordering - oldest properties first
        },
      });

      scopedLogger.info('Found matching properties', {
        userId: user.id,
        propertyCount: properties.length,
        limit: remainingLimit
      });

      if (properties.length === 0) {
        scopedLogger.info('No properties to process, skipping user', { userId: user.id });
        continue;
      }

      // Group properties by contact (owner)
      const contactPropertyMap = new Map<number, number[]>();
      const uniqueContacts = new Set<number>();

      for (const property of properties) {
        if (property.ownerId) {
          uniqueContacts.add(property.ownerId);

          if (!contactPropertyMap.has(property.ownerId)) {
            contactPropertyMap.set(property.ownerId, []);
          }
          contactPropertyMap.get(property.ownerId)!.push(property.id);
        }
      }

      scopedLogger.info('Grouped properties by contact', {
        userId: user.id,
        contactCount: uniqueContacts.size
      });

      // Create one job per contact (with their properties)
      let jobsCreatedForUser = 0;

      for (const [contactId, propertyIds] of contactPropertyMap) {
        const idempotencyKey = generateIdempotencyKey(
          "contact",
          contactId,
          date
        );

        const payload: DailyLeadAssignmentPayload = {
          userId: user.id,
          contactId,
          propertyIds,
          date,
          idempotencyKey,
        };

        if (options.dryRun) {
          scopedLogger.info('[DRY RUN] Would create job', {
            contactId,
            propertyCount: propertyIds.length
          });
        } else {
          try {
            const jobId = await boss.send(queueName, payload, {
              singletonKey: idempotencyKey,
              retryLimit: 3,
              retryDelay: 60,
              retryBackoff: true,
              expireInSeconds: 3600, // Jobs expire after 1 hour
            });

            if (jobId) {
              jobsCreatedForUser++;
              result.jobsCreated++;

              // Create corresponding database record
              await prisma.job.create({
                data: {
                  id: jobId,
                  type: queueName,
                  payload: payload as unknown as Prisma.InputJsonValue,
                  userId: user.id,
                  status: "pending",
                },
              });
            }
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            scopedLogger.error('Failed to create job for contact', {
              contactId,
              error: errorMessage
            });
          }
        }
      }

      result.contactsProcessed += uniqueContacts.size;
      result.propertiesProcessed += properties.length;

      scopedLogger.info('Created jobs for user', {
        userId: user.id,
        jobsCreated: jobsCreatedForUser
      });
    }

    result.success = true;

    const duration = DateTime.now().diff(startTime, "seconds").seconds;
    scopedLogger.info('Provision complete', {
      jobsCreated: result.jobsCreated,
      contactsProcessed: result.contactsProcessed,
      propertiesProcessed: result.propertiesProcessed,
      durationSeconds: duration.toFixed(2)
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.error = errorMessage;
    scopedLogger.error('Provision failed', error);
    return result;
  }
}

/**
 * Check if data is ready for the given date
 * This would check if the nightly ingestion has completed
 */
async function checkDataReady(date: string): Promise<boolean> {
  try {
    // Check if there's a completed ingestion run for this date
    // You might check a specific table or marker
    const run = await prisma.ingestionRun.findFirst({
      where: {
        status: "completed",
        startedAt: {
          gte: new Date(
            `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
          ),
        },
      },
      orderBy: {
        startedAt: "desc",
      },
    });

    return !!run;
  } catch (error) {
    logger.warn("⚠️ Could not check data ready status", { error });
    // Fail-safe: assume data is ready
    return true;
  }
}

/**
 * Provision with retry logic (06:00, 06:10, 06:20)
 */
export async function provisionWithRetry(
  options: ProvisionOptions = {}
): Promise<ProvisionResult> {
  const maxRetries = options.maxRetries || 3;
  const times = getProvisionTimes();

  logger.info(`⏰ Provision Schedule`, {
    firstAttempt: formatForLog(times.first),
    retry1: formatForLog(times.retry1),
    retry2: formatForLog(times.retry2)
  });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.info(`🔄 Provision Attempt ${attempt}/${maxRetries}`);

    const result = await provisionDailyQueues(options);

    if (result.success) {
      logger.info(`✅ Provision successful on attempt ${attempt}`);
      return result;
    }

    if (attempt < maxRetries) {
      const delayMinutes = 10; // Wait 10 minutes between retries
      logger.info(`⏳ Waiting ${delayMinutes} minutes before retry...`);
      await new Promise((resolve) =>
        setTimeout(resolve, delayMinutes * 60 * 1000)
      );
    }
  }

  logger.error(`❌ Provision failed after ${maxRetries} attempts`);
  return {
    success: false,
    date: todayYYYYMMDD(),
    queueName: getDailyQueueName(
      JOB_TYPES.DAILY_LEAD_ASSIGNMENT,
      todayYYYYMMDD()
    ),
    jobsCreated: 0,
    contactsProcessed: 0,
    propertiesProcessed: 0,
    error: `Failed after ${maxRetries} attempts`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Helper to safely check if running as main module
 * In test environments, we never run the CLI code regardless
 */
function isMainModule(): boolean {
  // Never execute CLI code in test environment
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    return false;
  }

  // In production/development, assume direct execution
  // This file should only be run directly via Node.js, not imported in browser contexts
  return true;
}

/**
 * CLI entry point - only runs when executed directly (not in tests)
 */
if (isMainModule()) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const withRetry = args.includes("--retry");

  logger.info(`🚀 Starting Daily Queue Provisioning`, { dryRun, withRetry });

  const provisionFn = withRetry ? provisionWithRetry : provisionDailyQueues;

  provisionFn({ dryRun })
    .then((result) => {
      if (result.success) {
        logger.info(`✅ Provisioning completed successfully`);
        process.exit(0);
      } else {
        logger.error(`❌ Provisioning failed`, { error: result.error });
        process.exit(1);
      }
    })
    .catch((error) => {
      logger.error(`💥 Unexpected error`, { error });
      process.exit(1);
    });
}

