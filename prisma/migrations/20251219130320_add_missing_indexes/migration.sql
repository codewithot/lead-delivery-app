-- CreateIndex
CREATE INDEX "Contact_pushed_idx" ON "Contact"("pushed");

-- CreateIndex
CREATE INDEX "Job_userId_idx" ON "Job"("userId");

-- CreateIndex
CREATE INDEX "Property_pushed_idx" ON "Property"("pushed");

-- CreateIndex
CREATE INDEX "Property_ownerId_idx" ON "Property"("ownerId");

-- CreateIndex
CREATE INDEX "Property_Postal Code_idx" ON "Property"("Postal Code");
