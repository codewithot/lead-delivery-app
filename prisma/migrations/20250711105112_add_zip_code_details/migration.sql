/*
  Warnings:

  - The primary key for the `ZipCode` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `code` on the `ZipCode` table. All the data in the column will be lost.
  - You are about to drop the column `latitude` on the `ZipCode` table. All the data in the column will be lost.
  - You are about to drop the column `longitude` on the `ZipCode` table. All the data in the column will be lost.
  - Added the required column `city` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `county_fips` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `county_fips_all` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `county_name` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `county_names_all` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `county_weights` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `imprecise` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lat` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lng` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `military` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `state_id` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `state_name` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `timezone` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `zcta` to the `ZipCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `zip` to the `ZipCode` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ZipCode" DROP CONSTRAINT "ZipCode_pkey",
DROP COLUMN "code",
DROP COLUMN "latitude",
DROP COLUMN "longitude",
ADD COLUMN     "city" TEXT NOT NULL,
ADD COLUMN     "county_fips" TEXT NOT NULL,
ADD COLUMN     "county_fips_all" TEXT NOT NULL,
ADD COLUMN     "county_name" TEXT NOT NULL,
ADD COLUMN     "county_names_all" TEXT NOT NULL,
ADD COLUMN     "county_weights" TEXT NOT NULL,
ADD COLUMN     "density" DOUBLE PRECISION,
ADD COLUMN     "imprecise" BOOLEAN NOT NULL,
ADD COLUMN     "lat" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "lng" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "military" BOOLEAN NOT NULL,
ADD COLUMN     "parent_zcta" TEXT,
ADD COLUMN     "population" INTEGER,
ADD COLUMN     "state_id" TEXT NOT NULL,
ADD COLUMN     "state_name" TEXT NOT NULL,
ADD COLUMN     "timezone" TEXT NOT NULL,
ADD COLUMN     "zcta" BOOLEAN NOT NULL,
ADD COLUMN     "zip" TEXT NOT NULL,
ADD CONSTRAINT "ZipCode_pkey" PRIMARY KEY ("zip");
