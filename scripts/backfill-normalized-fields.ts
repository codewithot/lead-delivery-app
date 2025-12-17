import { PrismaClient } from "@prisma/client";
import {
  normalizeEmail,
  normalizePhone,
  normalizeAddress,
} from "../src/lib/normalizers";

const prisma = new PrismaClient();

async function backfillContacts() {
  const contacts = await prisma.contact.findMany({
    where: {
      OR: [{ emailNormalized: null }, { phoneNormalized: null }],
    },
  });

  console.log(`📧 Backfilling ${contacts.length} contacts...`);

  let count = 0;
  for (const contact of contacts) {
    const emailNorm = normalizeEmail(contact.email);
    const phoneNorm = normalizePhone(contact.phone);

    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        emailNormalized: emailNorm.normalized || null, // ✅ Handle empty string
        phoneNormalized: phoneNorm.normalized || null, // ✅ Handle empty string
      },
    });

    count++;
    if (count % 100 === 0) {
      console.log(`   Processed ${count}/${contacts.length}...`);
    }
  }

  console.log(`✅ Backfilled ${contacts.length} contacts`);
}

async function backfillProperties() {
  const properties = await prisma.property.findMany({
    where: {
      addressNormalized: null,
    },
  });

  console.log(`🏠 Backfilling ${properties.length} properties...`);

  let count = 0;
  for (const property of properties) {
    const addressNorm = normalizeAddress(property.addressFull);

    await prisma.property.update({
      where: { id: property.id },
      data: {
        addressNormalized: addressNorm.normalized || null, // ✅ Handle empty string
      },
    });

    count++;
    if (count % 100 === 0) {
      console.log(`   Processed ${count}/${properties.length}...`);
    }
  }

  console.log(`✅ Backfilled ${properties.length} properties`);
}

async function main() {
  console.log("\n🚀 Starting backfill of normalized fields...\n");

  await backfillContacts();
  await backfillProperties();

  console.log("\n✅ Backfill complete!\n");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
