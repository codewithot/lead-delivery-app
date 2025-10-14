-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);
