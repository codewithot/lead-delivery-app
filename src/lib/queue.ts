// src/lib/queue.ts
import { PgBoss } from "pg-boss";

let boss: PgBoss | null = null;

export async function getQueueInstance(): Promise<PgBoss> {
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: "pgboss",
  });

  boss.on("error", (error: Error) => {
    console.error("pg-boss error:", error);
  });

  await boss.start();
  console.log("✅ pg-boss started successfully");

  return boss;
}

export async function closeQueue(): Promise<void> {
  if (boss) {
    await boss.stop({ timeout: 30000 });
    boss = null;
    console.log("✅ pg-boss stopped");
  }
}

// Job type definitions
export const JOB_TYPES = {
  DELIVER_LEADS: "deliver-leads",
  DELIVER_LEADS_BATCH: "deliver-leads-batch",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export interface DeliverLeadsPayload {
  ingestedAt: string;
  runId: string;
  userId: string;
}

export interface DeliverLeadsBatchPayload {
  ingestedAt: string;
  runId: string;
  userId: string;
  batchIndex: number; // Which batch (0-indexed)
  batchSize: number; // Properties per batch
  totalBatches: number; // Total batches for this user
}
