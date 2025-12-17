// src/jobs/leadAssignment.ts
import { PrismaClient } from "@prisma/client";
import { pushLeadsForUser } from "../lib/pushLeads";
const prisma = new PrismaClient();
/**
 * Process a daily lead assignment job
 * This is called by workers when processing jobs from the daily queue
 */
export async function processLeadAssignment(payload) {
    console.log(`📋 Processing lead assignment for contact ${payload.contactId}`);
    console.log(`   User: ${payload.userId}`);
    console.log(`   Properties: ${payload.propertyIds.length}`);
    console.log(`   Date: ${payload.date}`);
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
            console.warn(`⚠️ No properties found for IDs: ${payload.propertyIds.join(", ")}`);
            return;
        }
        console.log(`✅ Found ${properties.length} properties for contact ${contact.id}`);
        // Create a synthetic Job object for pushLeadsForUser
        const syntheticJob = {
            id: payload.idempotencyKey, // Use idempotency key as job ID
            type: "daily-lead-assignment",
            payload: {
                userId: payload.userId,
                contactId: payload.contactId,
                propertyIds: payload.propertyIds,
                contact,
                properties,
            },
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
        // Call the existing push leads function
        await pushLeadsForUser(syntheticJob);
        console.log(`✅ Successfully processed contact ${payload.contactId}`);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to process lead assignment:`, errorMessage);
        throw error;
    }
}
