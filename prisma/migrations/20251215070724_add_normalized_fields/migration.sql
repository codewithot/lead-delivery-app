-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "email_normalized" TEXT,
ADD COLUMN     "phone_normalized" TEXT;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "address_normalized" TEXT;

-- CreateIndex
CREATE INDEX "Contact_email_normalized_idx" ON "Contact"("email_normalized");

-- CreateIndex
CREATE INDEX "Contact_phone_normalized_idx" ON "Contact"("phone_normalized");

-- CreateIndex
CREATE INDEX "Property_address_normalized_idx" ON "Property"("address_normalized");
