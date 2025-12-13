-- CreateTable
CREATE TABLE "JobIdempotency" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "JobIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobIdempotency_queueName_idx" ON "JobIdempotency"("queueName");

-- CreateIndex
CREATE INDEX "JobIdempotency_status_idx" ON "JobIdempotency"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JobIdempotency_queueName_idempotencyKey_key" ON "JobIdempotency"("queueName", "idempotencyKey");
