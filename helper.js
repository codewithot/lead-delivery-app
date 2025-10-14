// scripts/resetPushed.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function resetAllPushed() {
  try {
    const contactResult = await prisma.contact.updateMany({
      data: { pushed: false },
    });

    const propertyResult = await prisma.property.updateMany({
      data: { pushed: false },
    });

    console.log(
      `✅ Updated ${contactResult.count} contacts to pushed = false.`
    );
    console.log(
      `✅ Updated ${propertyResult.count} properties to pushed = false.`
    );
  } catch (error) {
    console.error("❌ Error resetting pushed flags:", error);
  } finally {
    await prisma.$disconnect();
  }
}

resetAllPushed();


// // scripts/checkPushed.js
// import { PrismaClient } from "@prisma/client";

// const prisma = new PrismaClient();

// async function checkPushedStatus() {
//   try {
//     const pushedContacts = await prisma.contact.count({
//       where: { pushed: true },
//     });

//     const totalContacts = await prisma.contact.count();

//     const pushedProperties = await prisma.property.count({
//       where: { pushed: true },
//     });

//     const totalProperties = await prisma.property.count();

//     console.log("\n📊 Pushed Status Report:");
//     console.log("========================");
//     console.log(`\n📇 Contacts:`);
//     console.log(`   Pushed: ${pushedContacts} / ${totalContacts}`);
//     console.log(`   Not Pushed: ${totalContacts - pushedContacts}`);
    
//     console.log(`\n🏠 Properties:`);
//     console.log(`   Pushed: ${pushedProperties} / ${totalProperties}`);
//     console.log(`   Not Pushed: ${totalProperties - pushedProperties}`);
//     console.log("\n========================\n");

//   } catch (error) {
//     console.error("❌ Error checking pushed status:", error);
//   } finally {
//     await prisma.$disconnect();
//   }
// }

// checkPushedStatus();