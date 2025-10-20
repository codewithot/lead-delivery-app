/*
  Warnings:

  - A unique constraint covering the columns `[ghlPropertyId]` on the table `Property` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "ghlPropertyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Property_ghlPropertyId_key" ON "Property"("ghlPropertyId");
