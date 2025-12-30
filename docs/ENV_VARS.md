# Environment Variables Reference

This document lists all environment variables required or used by the Lead Delivery App.

## Application Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Application environment (`development`, `production`, `test`) | `development` |
| `PORT` | The port the Next.js application runs on | `3000` |
| `NEXTAUTH_URL` | The full URL of your application (used by NextAuth) | - |
| `NEXTAUTH_SECRET` | Secret used to sign session cookies | - |
| `NEXT_PUBLIC_APP_URL` | Frontend URL for generating links in alerts | - |
| `TIMEOUT` | Axios request timeout in milliseconds | `30000` |

## Database

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JOB_PG_POOL_MAX` | Max database connection pool size for jobs |

## Redis (API Rate Limiting)

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_HOST` | Redis host address | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password (if any) | - |
| `REDIS_DB` | Redis database index | `0` |
| `REDIS_URL` | Full Redis connection URL (alternative to individual variables) | - |
| `REDIS_TLS` | Set to `true` to enable TLS for Redis connection | `false` |
| `RATE_LIMIT_ENABLED` | Global toggle for rate limiting | `true` |

## GoHighLevel (GHL) OAuth

| Variable | Description |
|----------|-------------|
| `GHL_CLIENT_ID` | Your GHL Marketplace App Client ID |
| `GHL_CLIENT_SECRET` | Your GHL Marketplace App Client Secret |

## Worker System

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKER_COUNT` | Number of concurrent worker processes | `10` |
| `JOB_CONCURRENCY` | Number of jobs each worker processes concurrently | `10` |
| `REGION_TZ` | Timezone for internal scheduling | `America/New_York` |
| `MEMORY_ALERT_THRESHOLD` | RSS memory threshold for logging alerts (MB) | `600` |
| `USE_STANDALONE_WORKERS` | Set to `true` to spawn workers on webhook ingest | `false` |
| `PROPERTIES_PER_BATCH` | Number of properties processed in a single job batch | `100` |

## Alerts & Monitoring

| Variable | Description |
|----------|-------------|
| `SLACK_WEBHOOK_URL` | Webhook URL for Slack failure alerts |
| `SLACK_CHANNEL` | Slack channel name for alerts |
| `ALERT_EMAIL_ENABLED` | Set to `true` to enable email alerts |
| `ALERT_EMAIL_TO` | Comma-separated list of recipient emails |
| `ALERT_EMAIL_FROM` | Sender email address for alerts |
| `ALERT_WEBHOOK_URL` | URL for external status/failure webhooks |
| `ALERT_WEBHOOK_SECRET` | Secret for verifying external status webhooks |

## Security

| Variable | Description |
|----------|-------------|
| `WEBHOOK_SECRET` | Secret expected in the `x-hook-secret` header for incoming webhooks |
