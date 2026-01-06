// fix-missing-associations.ts - Retroactively create associations for pushed properties that lack associations
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import {
    ensureContactPropertyAssociation,
    findGhlContactByEmailOrPhone
} from '../src/lib/helper';

const prisma = new PrismaClient();

async function fixMissingAssociations() {
    console.log('🔧 Fixing missing property-contact associations...\n');

    // Get the user
    const user = await prisma.user.findFirst({
        where: { email: 'victoryikuomola@gmail.com' },
        select: {
            id: true,
            email: true,
            locationId: true,
            accessToken: true,
        }
    });

    if (!user || !user.accessToken || !user.locationId) {
        console.log('❌ User not found or missing token/locationId');
        return;
    }

    console.log(`📋 User: ${user.email}`);
    console.log(`   LocationId: ${user.locationId}`);

    // Get all pushed properties with their owners
    const properties = await prisma.property.findMany({
        where: {
            pushed: true,
            ghlPropertyId: { not: null },
        },
        include: {
            owner: {
                select: {
                    id: true,
                    email: true,
                    phone: true,
                    ghlContactId: true,
                }
            }
        }
    });

    console.log(`\n📊 Found ${properties.length} pushed properties with ghlPropertyId`);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const prop of properties) {
        if (!prop.ghlPropertyId) {
            console.log(`⚠️ Property ${prop.id}: No ghlPropertyId, skipping`);
            skippedCount++;
            continue;
        }

        if (!prop.owner) {
            console.log(`⚠️ Property ${prop.id}: No owner, skipping`);
            skippedCount++;
            continue;
        }

        let ghlContactId = prop.owner.ghlContactId;

        // If owner doesn't have ghlContactId, try to find it
        if (!ghlContactId) {
            console.log(`🔍 Property ${prop.id}: Owner ${prop.owner.id} has no ghlContactId, searching GHL...`);
            try {
                ghlContactId = await findGhlContactByEmailOrPhone(
                    prop.owner.email,
                    prop.owner.phone,
                    user.accessToken!,
                    user.locationId!
                ) ?? null;

                if (ghlContactId) {
                    // Update the contact with the found ghlContactId
                    await prisma.contact.update({
                        where: { id: prop.owner.id },
                        data: { ghlContactId }
                    });
                    console.log(`   ✅ Found and updated ghlContactId: ${ghlContactId}`);
                } else {
                    console.log(`   ❌ Could not find contact in GHL`);
                    skippedCount++;
                    continue;
                }
            } catch (err) {
                console.log(`   ❌ Error searching for contact:`, err);
                skippedCount++;
                continue;
            }
        }

        if (!ghlContactId) {
            console.log(`⚠️ Property ${prop.id}: Could not get ghlContactId for owner, skipping`);
            skippedCount++;
            continue;
        }

        // Create the association
        console.log(`🔗 Property ${prop.id}: Creating association...`);
        console.log(`   Contact: ${ghlContactId}`);
        console.log(`   Property: ${prop.ghlPropertyId}`);

        try {
            await ensureContactPropertyAssociation(
                ghlContactId,
                prop.ghlPropertyId,
                user.accessToken!,
                user.locationId!,
                'fix-associations'
            );
            successCount++;
            console.log(`   ✅ Association created successfully!`);
        } catch (err: any) {
            errorCount++;
            console.log(`   ❌ Error creating association:`, err?.response?.data || err?.message || err);
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n📊 Results:`);
    console.log(`   ✅ Successful associations: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   ⚠️ Skipped: ${skippedCount}`);

    await prisma.$disconnect();
}

fixMissingAssociations().catch(console.error);
