// src/lib/alerts.ts
import { Job } from "@prisma/client";

/**
 * Alert configuration from environment variables
 */
interface AlertConfig {
  slack?: {
    webhookUrl: string;
    channel?: string;
  };
  email?: {
    enabled: boolean;
    to: string[];
    from: string;
  };
  webhook?: {
    url: string;
    secret?: string;
  };
}

/**
 * Get alert configuration from environment
 */
function getAlertConfig(): AlertConfig {
  return {
    slack: process.env.SLACK_WEBHOOK_URL
      ? {
          webhookUrl: process.env.SLACK_WEBHOOK_URL,
          channel: process.env.SLACK_CHANNEL,
        }
      : undefined,
    email:
      process.env.ALERT_EMAIL_ENABLED === "true"
        ? {
            enabled: true,
            to: (process.env.ALERT_EMAIL_TO || "").split(","),
            from: process.env.ALERT_EMAIL_FROM || "noreply@example.com",
          }
        : undefined,
    webhook: process.env.ALERT_WEBHOOK_URL
      ? {
          url: process.env.ALERT_WEBHOOK_URL,
          secret: process.env.ALERT_WEBHOOK_SECRET,
        }
      : undefined,
  };
}

/**
 * Format job details for alert message
 */
function formatJobDetails(job: Job): string {
  return `
Job ID: ${job.id}
Type: ${job.type}
User ID: ${job.userId}
Attempts: ${job.attempts}/${job.maxAttempts}
Last Error: ${job.lastError || "N/A"}
Created: ${job.createdAt.toISOString()}
Failed: ${job.updatedAt.toISOString()}
  `.trim();
}

/**
 * Send Slack alert
 */
async function sendSlackAlert(job: Job, config: AlertConfig): Promise<void> {
  if (!config.slack) return;

  const payload = {
    channel: config.slack.channel,
    username: "Lead Delivery Bot",
    icon_emoji: ":warning:",
    text: `🚨 Job Failed After ${job.maxAttempts} Attempts`,
    attachments: [
      {
        color: "danger",
        title: `Job ${job.id} - ${job.type}`,
        text: formatJobDetails(job),
        footer: "Lead Delivery System",
        ts: Math.floor(Date.now() / 1000),
        actions: [
          {
            type: "button",
            text: "View Dashboard",
            url: `${process.env.NEXT_PUBLIC_APP_URL}/admin/failed-jobs`,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(config.slack.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        "Failed to send Slack alert:",
        response.status,
        await response.text()
      );
    } else {
      console.log(`✅ Slack alert sent for job ${job.id}`);
    }
  } catch (error) {
    console.error("Error sending Slack alert:", error);
  }
}

/**
 * Send email alert (placeholder - integrate with SendGrid/SES)
 */
async function sendEmailAlert(job: Job, config: AlertConfig): Promise<void> {
  if (!config.email?.enabled) return;

  console.log(`📧 Email alert would be sent to: ${config.email.to.join(", ")}`);
  console.log(`Subject: Job Failed - ${job.id}`);
  console.log(`Body: ${formatJobDetails(job)}`);

  // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
  // Example with SendGrid:
  /*
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  
  const msg = {
    to: config.email.to,
    from: config.email.from,
    subject: `Job Failed - ${job.id}`,
    text: formatJobDetails(job),
    html: `<pre>${formatJobDetails(job)}</pre>`,
  };
  
  await sgMail.send(msg);
  */
}

/**
 * Send webhook alert
 */
async function sendWebhookAlert(job: Job, config: AlertConfig): Promise<void> {
  if (!config.webhook) return;

  const payload = {
    event: "job.failed",
    timestamp: new Date().toISOString(),
    job: {
      id: job.id,
      type: job.type,
      userId: job.userId,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      createdAt: job.createdAt.toISOString(),
      failedAt: job.updatedAt.toISOString(),
    },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.webhook.secret) {
    headers["X-Webhook-Secret"] = config.webhook.secret;
  }

  try {
    const response = await fetch(config.webhook.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        "Failed to send webhook alert:",
        response.status,
        await response.text()
      );
    } else {
      console.log(`✅ Webhook alert sent for job ${job.id}`);
    }
  } catch (error) {
    console.error("Error sending webhook alert:", error);
  }
}

/**
 * Main alert function - sends all configured alerts
 */
export async function sendJobFailureAlert(job: Job): Promise<void> {
  console.log(`🚨 Sending failure alerts for job ${job.id}`);

  const config = getAlertConfig();

  // Send all configured alerts in parallel
  await Promise.allSettled([
    sendSlackAlert(job, config),
    sendEmailAlert(job, config),
    sendWebhookAlert(job, config),
  ]);

  console.log(`✅ Failure alerts sent for job ${job.id}`);
}

/**
 * Send batch failure summary (for multiple failures)
 */
export async function sendBatchFailureAlert(
  jobs: Job[],
  timeRange: { start: Date; end: Date }
): Promise<void> {
  const config = getAlertConfig();

  if (config.slack) {
    const payload = {
      channel: config.slack.channel,
      username: "Lead Delivery Bot",
      icon_emoji: ":rotating_light:",
      text: `🚨 Multiple Job Failures Detected`,
      attachments: [
        {
          color: "danger",
          title: `${
            jobs.length
          } jobs failed between ${timeRange.start.toISOString()} and ${timeRange.end.toISOString()}`,
          fields: [
            {
              title: "Failed Jobs",
              value: jobs.map((j) => `• ${j.id} (${j.type})`).join("\n"),
              short: false,
            },
          ],
          footer: "Lead Delivery System",
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    try {
      await fetch(config.slack.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Error sending batch alert:", error);
    }
  }
}
