/*
  Warnings:

  - The primary key for the `Property` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `price` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `rawData` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `zip` on the `Property` table. All the data in the column will be lost.
  - The `id` column on the `Property` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[ownerId,Address (full)]` on the table `Property` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `ownerId` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `direction` to the `WebhookLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `url` to the `WebhookLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Property" DROP CONSTRAINT "Property_pkey",
DROP COLUMN "price",
DROP COLUMN "rawData",
DROP COLUMN "zip",
ADD COLUMN     "Above Grade Finished SqFt" TEXT,
ADD COLUMN     "Address (full)" TEXT,
ADD COLUMN     "Attorney" TEXT,
ADD COLUMN     "Attorney Phone Number" TEXT,
ADD COLUMN     "Automated Value" TEXT,
ADD COLUMN     "Automated Value Maximum" TEXT,
ADD COLUMN     "Automated Value Minimum" TEXT,
ADD COLUMN     "Basement SqFt" TEXT,
ADD COLUMN     "Basement Type" TEXT,
ADD COLUMN     "Bathrooms" TEXT,
ADD COLUMN     "Bedrooms" TEXT,
ADD COLUMN     "City" TEXT,
ADD COLUMN     "Contact 1 Email 2" TEXT,
ADD COLUMN     "Contact 1 Phone 1 DNC" TEXT,
ADD COLUMN     "Contact 1 Phone 1 Line Type" TEXT,
ADD COLUMN     "Contact 1 Phone 2" TEXT,
ADD COLUMN     "Contact 1 Phone 2 DNC" TEXT,
ADD COLUMN     "Contact 1 Phone 2 Line Type" TEXT,
ADD COLUMN     "Contact 1 Phone 3" TEXT,
ADD COLUMN     "Contact 2" TEXT,
ADD COLUMN     "Contact 2 Email 1" TEXT,
ADD COLUMN     "Contact 2 Email 2" TEXT,
ADD COLUMN     "Contact 2 Phone 1" TEXT,
ADD COLUMN     "Contact 2 Phone 1 DNC" TEXT,
ADD COLUMN     "Contact 2 Phone 1 Line Type" TEXT,
ADD COLUMN     "Contact 2 Phone 2" TEXT,
ADD COLUMN     "Contact 2 Phone 2 DNC" TEXT,
ADD COLUMN     "Contact 2 Phone 2 Line Type" TEXT,
ADD COLUMN     "Cooling Type" TEXT,
ADD COLUMN     "Country" TEXT,
ADD COLUMN     "County" TEXT,
ADD COLUMN     "Data" TEXT,
ADD COLUMN     "Date Of Auction" TEXT,
ADD COLUMN     "Equity %" TEXT,
ADD COLUMN     "Est Opening Bid" TEXT,
ADD COLUMN     "Estimated Equity" TEXT,
ADD COLUMN     "Estimated Mtg Balance" TEXT,
ADD COLUMN     "Estimated Mtg Payment" TEXT,
ADD COLUMN     "First Lien Amount" TEXT,
ADD COLUMN     "Free and Clear" TEXT,
ADD COLUMN     "Heating Type" TEXT,
ADD COLUMN     "Home Condition" TEXT,
ADD COLUMN     "Household Income" TEXT,
ADD COLUMN     "In Preforclosure" TEXT,
ADD COLUMN     "Landline 1" TEXT,
ADD COLUMN     "Landline 2" TEXT,
ADD COLUMN     "Landline 3" TEXT,
ADD COLUMN     "Landline 4" TEXT,
ADD COLUMN     "Landline 5" TEXT,
ADD COLUMN     "Lead Source" TEXT,
ADD COLUMN     "Lender Name" TEXT,
ADD COLUMN     "Liquid Assets" TEXT,
ADD COLUMN     "Loan Maturity Date" TEXT,
ADD COLUMN     "Loan Type" TEXT,
ADD COLUMN     "Lot Size" TEXT,
ADD COLUMN     "MLS Number" TEXT,
ADD COLUMN     "MLS Status" TEXT,
ADD COLUMN     "Owner Address" TEXT,
ADD COLUMN     "Owner City" TEXT,
ADD COLUMN     "Owner Occupied" TEXT,
ADD COLUMN     "Owner State" TEXT,
ADD COLUMN     "Owner Status" TEXT,
ADD COLUMN     "Owner Type" TEXT,
ADD COLUMN     "Owner Zip" TEXT,
ADD COLUMN     "Parking Spaces" TEXT,
ADD COLUMN     "Parking Type" TEXT,
ADD COLUMN     "Plaintiff Name" TEXT,
ADD COLUMN     "Pool" TEXT,
ADD COLUMN     "Postal Code" TEXT,
ADD COLUMN     "Price" TEXT,
ADD COLUMN     "Property Type" TEXT,
ADD COLUMN     "Realtor's Name" TEXT,
ADD COLUMN     "Rental History" TEXT,
ADD COLUMN     "Resale Value (ARV)" TEXT,
ADD COLUMN     "Seller Motivation" TEXT,
ADD COLUMN     "Seller Timing" TEXT,
ADD COLUMN     "State" TEXT,
ADD COLUMN     "Street address" TEXT,
ADD COLUMN     "Tags" TEXT,
ADD COLUMN     "Tax Value" TEXT,
ADD COLUMN     "Working with Realtor" TEXT,
ADD COLUMN     "Year Built" TEXT,
ADD COLUMN     "asking price" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ownerId" INTEGER NOT NULL,
ADD COLUMN     "pushed" BOOLEAN NOT NULL DEFAULT false,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Property_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "WebhookLog" ADD COLUMN     "direction" TEXT NOT NULL,
ADD COLUMN     "responseBody" JSONB,
ADD COLUMN     "responseCode" INTEGER,
ADD COLUMN     "runId" INTEGER,
ADD COLUMN     "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "url" TEXT NOT NULL,
ALTER COLUMN "receivedAt" DROP NOT NULL,
ALTER COLUMN "receivedAt" DROP DEFAULT,
ALTER COLUMN "payload" DROP NOT NULL,
ALTER COLUMN "headers" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Contact" (
    "id" SERIAL NOT NULL,
    "Contact Id" TEXT NOT NULL,
    "First Name" TEXT,
    "Last Name" TEXT,
    "Business Name" TEXT,
    "Company Name" TEXT,
    "Phone" TEXT,
    "Email" TEXT,
    "Additional Phones" TEXT,
    "Additional Emails" TEXT,
    "Additional Emails.1" TEXT,
    "Additional Phones.1" TEXT,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "rowCount" INTEGER,
    "error" TEXT,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedFile" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" INTEGER NOT NULL,

    CONSTRAINT "ProcessedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_Contact Id_key" ON "Contact"("Contact Id");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedFile_name_key" ON "ProcessedFile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Property_ownerId_Address (full)_key" ON "Property"("ownerId", "Address (full)");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedFile" ADD CONSTRAINT "ProcessedFile_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
