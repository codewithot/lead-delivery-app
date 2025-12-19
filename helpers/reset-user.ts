import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function resetUser(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return console.log("User not found");

    // 1. Delete the linked account
    await prisma.account.deleteMany({
        where: { userId: user.id, provider: "gh" }
    });

    // 2. Clear user GHL fields
    await prisma.user.update({
        where: { id: user.id },
        data: {
            ghUserId: null,
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
            locationId: null,
            companyId: null,
        }
    });

    console.log(`Successfully unlinked GHL for ${email}`);
}

resetUser("victoryikuomola@gmail.com");
resetUser("testuser@gmail.com");


// to run: npx tsx helpers/reset-user.ts