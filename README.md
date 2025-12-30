# Lead Delivery App

A robust, high-performance system for ingesting, queuing, and delivering leads to **GoHighLevel (GHL)** locations.

## 🚀 Overview

This application serves as a bridge between lead generation sources and GHL. It handles high-volume ingestion via webhooks, manages delivery jobs using a persistent queue (`pg-boss`), and ensures reliability through automatic retries, rate limiting, and memory-optimized background workers.

## ✨ Key Features

- **Lead Ingestion**: Secure webhook endpoint with payload validation and logging.
- **Job Queuing**: Robust background processing powered by `pg-boss` and PostgreSQL.
- **GHL Integration**: Full OAuth 2.0 flow for connecting and managing GHL locations.
- **Rate Limiting**: Multi-tier API rate limiting (Webhook, Write, Read, Auth) using Redis.
- **Worker System**: Multi-process, memory-constrained master/slave worker architecture.
- **Daily Provisioning**: Automated daily queue preparation for all active users.
- **Alerting**: Failure notifications via Slack, Email, and status webhooks.

## 📚 Documentation Reference

For detailed guides and technical specifications, please refer to the following:

- **Deployment**: [DEPLOYMENT.md](./docs/DEPLOYMENT.md) — Production setup, PM2, and memory configuration.
- **Environment**: [ENV_VARS.md](./docs/ENV_VARS.md) — Complete list of environment variables.
- **Scheduling**: [CRON_JOBS.md](./docs/CRON_JOBS.md) — Internal and external cron configurations.
- **OAuth Flow**: [OAUTH_FLOW.md](./docs/OAUTH_FLOW.md) — Logic and flow for GHL connections.
- **API Reference**: [API.md](./docs/API.md) — Overview of key API endpoints.
- **Troubleshooting**: [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) — Solutions for common issues.

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (ESM)
- **Database**: [PostgreSQL](https://www.postgresql.org/) with [Prisma ORM](https://www.prisma.io/)
- **Queuing**: [pg-boss](https://github.com/timgit/pg-boss)
- **Auth**: [NextAuth.js](https://next-auth.js.org/)
- **Caching/Limiting**: [Redis](https://redis.io/) via `rate-limiter-flexible`
- **Validation**: [Zod](https://zod.dev/)

## 🏃 Getting Started

### Prerequisites

1.  **PostgreSQL** database.
2.  **Redis** instance (optional, recommended for production).
3.  **GoHighLevel** Marketplace App credentials.

### Development

```bash
# 1. Install dependencies
npm install

# 2. Run migrations
npx prisma migrate dev

# 3. Start dev server
npm run dev

# 4. Start workers (separate terminal)
npm run workers
```

Refer to the [Deployment Guide](./docs/DEPLOYMENT.md) for production instructions.