// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

async function main() {
  // 1) Read the CSV
  const text = fs.readFileSync("src/data/uszips.csv", "utf8");
  const records = parse(text, {
    columns: true, // Automatically maps CSV headers to object keys
    skip_empty_lines: true,
  });

  console.log(`Seeding ${records.length} ZIP codes…`);

  // 2) Batch insert (skip duplicates)
  // Adjust batch size if you run into memory issues
  for (let i = 0; i < records.length; i += 1000) {
    const batch = records.slice(i, i + 1000).map((r: any) => ({
      // Map CSV column names to Prisma model field names
      code: r.zip,
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lng),
      city: r.city,
      stateId: r.state_id,
      stateName: r.state_name,
      // Convert string "TRUE"/"FALSE" to boolean values
      zcta: r.zcta === 'TRUE',
      imprecise: r.imprecise === 'TRUE',
      military: r.military === 'TRUE',
      // Convert population and density to numbers, handling potential empty strings as null
      // Note: The research indicates '0' and '0.0' values are present, which parseFloat/parseInt handle correctly.
      // This check primarily addresses truly empty strings in the CSV.
      population: r.population? parseInt(r.population, 10) : null,
      density: r.density? parseFloat(r.density) : null,
      countyFips: r.county_fips,
      countyName: r.county_name,
      // These fields are stored as raw strings as they contain complex formats (JSON-like, pipe-separated)
      countyWeights: r.county_weights,
      countyNamesAll: r.county_names_all,
      countyFipsAll: r.county_fips_all,
      // Handle parent_zcta as nullable string
      parentZcta: r.parent_zcta || null,
      timezone: r.timezone,
    }));

    await prisma.zipCode.createMany({
      data: batch,
      skipDuplicates: true,
    });
    console.log(
      `   Seeded ${Math.min(i + 1000, records.length)}/${records.length}`
    );
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