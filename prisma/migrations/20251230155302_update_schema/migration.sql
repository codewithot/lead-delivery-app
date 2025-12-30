/*
  Warnings:

  - The primary key for the `WebhookLog` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `WebhookLog` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- DropForeignKey
ALTER TABLE "Property" DROP CONSTRAINT "Property_ownerId_fkey";

-- AlterTable
ALTER TABLE "WebhookLog" DROP CONSTRAINT "WebhookLog_pkey",
ADD COLUMN     "errorMessage" TEXT,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
