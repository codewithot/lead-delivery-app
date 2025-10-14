"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// prisma/seed.ts
const client_1 = require("@prisma/client");
const fs = require("fs");
const sync_1 = require("csv-parse/sync");
const prisma = new client_1.PrismaClient();
async function main() {
    // 1) Read the CSV
    const text = fs.readFileSync("../src/data/uszips.csv", "utf8");
    const records = (0, sync_1.parse)(text, {
        columns: true,
        skip_empty_lines: true,
    });
    console.log(`Seeding ${records.length} ZIP codes…`);
    // 2) Batch insert (skip duplicates)
    // Adjust batch size if you run into memory issues
    for (let i = 0; i < records.length; i += 1000) {
        const batch = records.slice(i, i + 1000).map((r) => ({
            code: r.ZIP || r.ZCTA5CE10,
            latitude: parseFloat(r.LAT || r.INTPTLAT10),
            longitude: parseFloat(r.LNG || r.INTPTLON10),
        }));
        await prisma.zipCode.createMany({
            data: batch,
            skipDuplicates: true,
        });
        console.log(`  Seeded ${Math.min(i + 1000, records.length)}/${records.length}`);
    }
    console.log("✅ ZIP code seed complete");
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
