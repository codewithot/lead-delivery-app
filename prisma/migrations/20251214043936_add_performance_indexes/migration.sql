-- CreateIndex
CREATE INDEX "Job_status_attempts_idx" ON "Job"("status", "attempts");

-- CreateIndex
CREATE INDEX "Property_Price_idx" ON "Property"("Price");

-- CreateIndex
CREATE INDEX "Property_Postal Code_Price_pushed_idx" ON "Property"("Postal Code", "Price", "pushed");
