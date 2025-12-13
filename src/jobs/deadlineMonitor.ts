// src/jobs/deadlineMonitor.ts
import { PrismaClient } from "@prisma/client";
import { getTodayQueueName } from "../lib/queue";
import {
  minutesUntilDeadline,
  deadlineDateTime,
  formatForLog,
  getRegionTimezone,
} from "../lib/timezone";
import { DateTime } from "luxon";

const prisma = new PrismaClient();

interface MonitorMetrics {
  timestamp: string;
  queueName: string;
  minutesUntilDeadline: number;
  queueDepth: number;
  completedLastMin: number;
  failedLastMin: number;
  rssMB: number;
  heapMB: number;
  oldestJobAgeSeconds: number;
  processingRate: number; // jobs per minute
  estimatedCompletionMinutes: number;
  alerts: string[];
}

interface AlertConfig {
  deadlineWarningMinutes: number; // Alert when this close to deadline with jobs pending
  oldJobThresholdMinutes: number; // Alert when job age exceeds this
  minProcessingRate: number; // Alert if processing rate falls below this
}

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  deadlineWarningMinutes: 30,
  oldJobThresholdMinutes: 20,
  minProcessingRate: 1.0, // At least 1 job per minute
};

/**
 * Collect current metrics from queue and system
 */
export async function collectMetrics(): Promise<MonitorMetrics> {
  const now = DateTime.now().setZone(getRegionTimezone());
  const queueName = getTodayQueueName();
  const alerts: string[] = [];

  // Memory metrics
  const memUsage = process.memoryUsage();
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);

  // Queue depth - count pending and active jobs
  const queueDepth = await prisma.job.count({
    where: {
      type: queueName,
      status: {
        in: ["pending", "in_progress"],
      },
    },
  });

  // Jobs completed in last minute
  const oneMinuteAgo = now.minus({ minutes: 1 }).toJSDate();
  const completedLastMin = await prisma.job.count({
    where: {
      type: queueName,
      status: "completed",
      finishedAt: {
        gte: oneMinuteAgo,
      },
    },
  });

  // Jobs failed in last minute
  const failedLastMin = await prisma.job.count({
    where: {
      type: queueName,
      status: "failed",
      updatedAt: {
        gte: oneMinuteAgo,
      },
    },
  });

  // Find oldest pending/active job
  const oldestJob = await prisma.job.findFirst({
    where: {
      type: queueName,
      status: {
        in: ["pending", "in_progress"],
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      createdAt: true,
    },
  });

  const oldestJobAgeSeconds = oldestJob
    ? Math.floor(
        now.diff(DateTime.fromJSDate(oldestJob.createdAt), "seconds").seconds
      )
    : 0;

  // Calculate processing rate and estimate completion time
  const processingRate = completedLastMin; // jobs per minute
  const estimatedCompletionMinutes =
    processingRate > 0 ? Math.ceil(queueDepth / processingRate) : Infinity;

  const minutes = minutesUntilDeadline();

  const metrics: MonitorMetrics = {
    timestamp: formatForLog(now),
    queueName,
    minutesUntilDeadline: minutes,
    queueDepth,
    completedLastMin,
    failedLastMin,
    rssMB,
    heapMB,
    oldestJobAgeSeconds,
    processingRate,
    estimatedCompletionMinutes,
    alerts,
  };

  return metrics;
}

/**
 * Check for alert conditions and generate alerts
 */
export function checkAlerts(
  metrics: MonitorMetrics,
  config: AlertConfig = DEFAULT_ALERT_CONFIG
): string[] {
  const alerts: string[] = [];

  // Alert 1: Approaching deadline with jobs still pending
  if (
    metrics.minutesUntilDeadline <= config.deadlineWarningMinutes &&
    metrics.queueDepth > 0
  ) {
    alerts.push(
      `🚨 DEADLINE WARNING: ${metrics.minutesUntilDeadline} minutes until 7:00 AM, ` +
        `${metrics.queueDepth} jobs still pending`
    );
  }

  // Alert 2: Past deadline with jobs pending
  if (metrics.minutesUntilDeadline < 0 && metrics.queueDepth > 0) {
    alerts.push(
      `🔴 DEADLINE EXCEEDED: ${Math.abs(
        metrics.minutesUntilDeadline
      )} minutes past 7:00 AM, ` + `${metrics.queueDepth} jobs still pending`
    );
  }

  // Alert 3: Old job stuck in queue
  if (metrics.oldestJobAgeSeconds > config.oldJobThresholdMinutes * 60) {
    const ageMinutes = Math.floor(metrics.oldestJobAgeSeconds / 60);
    alerts.push(
      `⚠️ OLD JOB: Oldest job has been pending for ${ageMinutes} minutes ` +
        `(threshold: ${config.oldJobThresholdMinutes} minutes)`
    );
  }

  // Alert 4: Low processing rate
  if (
    metrics.queueDepth > 0 &&
    metrics.processingRate < config.minProcessingRate
  ) {
    alerts.push(
      `⚠️ SLOW PROCESSING: Rate ${metrics.processingRate.toFixed(
        2
      )} jobs/min ` + `(minimum: ${config.minProcessingRate} jobs/min)`
    );
  }

  // Alert 5: Won't finish before deadline
  if (
    metrics.queueDepth > 0 &&
    metrics.estimatedCompletionMinutes !== Infinity &&
    metrics.estimatedCompletionMinutes > metrics.minutesUntilDeadline
  ) {
    alerts.push(
      `⚠️ COMPLETION RISK: Estimated ${metrics.estimatedCompletionMinutes} minutes to complete, ` +
        `but only ${metrics.minutesUntilDeadline} minutes until deadline`
    );
  }

  // Alert 6: High memory usage
  const memoryThresholdMB = parseInt(
    process.env.MEMORY_ALERT_THRESHOLD || "600",
    10
  );
  if (metrics.rssMB > memoryThresholdMB) {
    alerts.push(
      `⚠️ HIGH MEMORY: RSS ${metrics.rssMB} MB ` +
        `(threshold: ${memoryThresholdMB} MB)`
    );
  }

  return alerts;
}

/**
 * Log metrics in a structured format
 */
export function logMetrics(
  metrics: MonitorMetrics,
  verbose: boolean = false
): void {
  if (verbose) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`📊 Queue Monitor - ${metrics.timestamp}`);
    console.log(`${"=".repeat(70)}`);
    console.log(`Queue: ${metrics.queueName}`);
    console.log(`⏰ Minutes until deadline: ${metrics.minutesUntilDeadline}`);
    console.log(`📦 Queue depth: ${metrics.queueDepth}`);
    console.log(`✅ Completed (last min): ${metrics.completedLastMin}`);
    console.log(`❌ Failed (last min): ${metrics.failedLastMin}`);
    console.log(
      `📈 Processing rate: ${metrics.processingRate.toFixed(2)} jobs/min`
    );
    console.log(
      `⏱️ Est. completion: ${
        metrics.estimatedCompletionMinutes === Infinity
          ? "N/A"
          : `${metrics.estimatedCompletionMinutes} min`
      }`
    );
    console.log(`👴 Oldest job age: ${metrics.oldestJobAgeSeconds}s`);
    console.log(
      `💾 Memory: RSS ${metrics.rssMB} MB, Heap ${metrics.heapMB} MB`
    );

    if (metrics.alerts.length > 0) {
      console.log(`\n🚨 ALERTS:`);
      metrics.alerts.forEach((alert) => console.log(`   ${alert}`));
    }
    console.log(`${"=".repeat(70)}\n`);
  } else {
    // Compact one-line format
    console.log(
      `[${metrics.timestamp}] ` +
        `Queue: ${metrics.queueDepth} pending | ` +
        `Rate: ${metrics.processingRate}/min | ` +
        `Deadline: ${metrics.minutesUntilDeadline}m | ` +
        `Memory: ${metrics.rssMB}MB | ` +
        `${metrics.alerts.length > 0 ? "⚠️ ALERTS" : "✅"}`
    );
  }
}

/**
 * Send alerts to external services (Slack, PagerDuty, etc.)
 */
export async function sendAlerts(alerts: string[]): Promise<void> {
  if (alerts.length === 0) return;

  // Example: Send to Slack webhook
  const slackWebhook = process.env.SLACK_WEBHOOK_URL;
  if (slackWebhook) {
    try {
      const response = await fetch(slackWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `🚨 Lead Delivery Alerts\n${alerts.join("\n")}`,
        }),
      });

      if (!response.ok) {
        console.error("Failed to send Slack alert:", response.statusText);
      }
    } catch (error) {
      console.error("Error sending Slack alert:", error);
    }
  }

  // Example: Log to monitoring service
  // Add your monitoring service integration here (DataDog, New Relic, etc.)
}

/**
 * Main monitoring loop
 */
export async function startMonitoring(
  intervalSeconds: number = 10,
  alertConfig?: AlertConfig
): Promise<void> {
  console.log(`\n🚀 Starting Deadline Monitor`);
  console.log(`   Interval: ${intervalSeconds} seconds`);
  console.log(`   Timezone: ${getRegionTimezone()}`);
  console.log(`   Deadline: ${formatForLog(deadlineDateTime())}\n`);

  const config = alertConfig || DEFAULT_ALERT_CONFIG;

  const monitorInterval = setInterval(async () => {
    try {
      const metrics = await collectMetrics();
      metrics.alerts = checkAlerts(metrics, config);

      // Log metrics
      logMetrics(metrics, false); // Set to true for verbose logging

      // Send alerts if any
      if (metrics.alerts.length > 0) {
        await sendAlerts(metrics.alerts);
      }

      // Stop monitoring if past deadline and queue is empty
      if (metrics.minutesUntilDeadline < -60 && metrics.queueDepth === 0) {
        console.log(
          `\n✅ Queue empty and past deadline window, stopping monitor\n`
        );
        clearInterval(monitorInterval);
      }
    } catch (error) {
      console.error("Error in monitoring loop:", error);
    }
  }, intervalSeconds * 1000);

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("\n👋 Stopping monitor...");
    clearInterval(monitorInterval);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n👋 Stopping monitor...");
    clearInterval(monitorInterval);
    process.exit(0);
  });
}

/**
 * CLI entry point
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const intervalArg = args.find((arg) => arg.startsWith("--interval="));
  const interval = intervalArg ? parseInt(intervalArg.split("=")[1], 10) : 10;

  const verbose = args.includes("--verbose");

  if (verbose) {
    console.log("Running in verbose mode");
  }

  startMonitoring(interval).catch((error) => {
    console.error("💥 Monitor failed:", error);
    process.exit(1);
  });
}
