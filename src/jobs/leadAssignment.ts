// src/jobs/leadAssignment.ts
import { PrismaClient } from "@prisma/client";
import { DailyLeadAssignmentPayload } from "../lib/queue";
import { pushLeadsForUser } from "../lib/pushLeads";
import type { Job } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { createLogger, generateCorrelationId } from "@/lib/secureLogger";

const logger = createLogger('LeadAssignment');
const prisma = new PrismaClient();

/**
 * Process a daily lead assignment job
 * This is called by workers when processing jobs from the daily queue
 */
export async function processLeadAssignment(
  payload: DailyLeadAssignmentPayload
): Promise<void> {
  // Generate correlation ID for this lead assignment
  const correlationId = generateCorrelationId('lead-assignment', `${payload.contactId}-${payload.date}`);
  const scopedLogger = logger.withCorrelationId(correlationId);

  scopedLogger.info("Processing lead assignment", {
    contactId: payload.contactId,
    userId: payload.userId,
    propertyCount: payload.propertyIds.length,
  });

  try {
    // Fetch the contact
    const contact = await prisma.contact.findUnique({
      where: { id: payload.contactId },
    });

    if (!contact) {
      throw new Error(`Contact ${payload.contactId} not found`);
    }

    // Fetch all properties for this contact
    const properties = await prisma.property.findMany({
      where: {
        id: { in: payload.propertyIds },
      },
      include: {
        owner: true,
      },
    });

    if (properties.length === 0) {
      scopedLogger.warn('No properties found for IDs', { propertyIds: payload.propertyIds });
      return;
    }

    scopedLogger.info('Found properties for contact', {
      propertyCount: properties.length,
      contactId: contact.id
    });

    // Create a synthetic Job object for pushLeadsForUser
    const syntheticJob: Job = {
      id: payload.idempotencyKey, // Use idempotency key as job ID
      type: "daily-lead-assignment",
      payload: {
        userId: payload.userId,
        contactId: payload.contactId,
        propertyIds: payload.propertyIds,
        contact,
        properties,
      } as unknown as Prisma.JsonValue,
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

    // Call the existing push leads function with correlation ID
    await pushLeadsForUser(syntheticJob, correlationId);

    scopedLogger.info('Successfully processed contact', { contactId: payload.contactId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    scopedLogger.error('Failed to process lead assignment', errorMessage);
    throw error;
  }
}
