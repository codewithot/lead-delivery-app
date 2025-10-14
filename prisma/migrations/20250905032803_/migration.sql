/*
  Warnings:

  - A unique constraint covering the columns `[ghlContactId]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Contact_ghlContactId_key" ON "Contact"("ghlContactId");
