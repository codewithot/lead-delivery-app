# Deployment Guide

This document provides instructions for deploying the Lead Delivery App to a production environment.

## 1. Prerequisites

- **Node.js**: v18 or higher (using ESM)
- **PostgreSQL**: v14 or higher
- **Redis**: For API rate limiting (can fallback to in-memory)
- **PM2**: For process management

## 2. Environment Setup

Create a `.env.production` file in the root directory. See [ENV_VARS.md](./ENV_VARS.md) for a complete reference.

```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
NEXTAUTH_SECRET="your-secret"
NEXTAUTH_URL="https://your-app-url.com"
GHL_CLIENT_ID="ghl-client-id"
GHL_CLIENT_SECRET="ghl-client-secret"
WEBHOOK_SECRET="webhook-secret"
```

## 3. Build the Application

The application requires building both the Next.js frontend/API and the worker processes.

```bash
# Install dependencies
npm install

# Build Next.js and Workers
npm run build
```

The `npm run build` command executes:
1. `next build`
2. `tsc -p tsconfig.workers.json` (Compiles TS workers to `dist/`)

## 4. Production Execution (PM2)

The recommended way to run the application in production is using **PM2**. We provide an `ecosystem.config.js` file pre-configured with memory limits and monitoring.

### pm2 ecosystem.config.js
```javascript
module.exports = {
  apps: [
    {
      name: "lead-workers",
      script: "dist/workers/master.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--max-old-space-size=768 --expose-gc",
      autorestart: true,
      max_memory_restart: "800M",
      env: {
        NODE_ENV: "production",
        WORKER_COUNT: "10",
        JOB_CONCURRENCY: "10",
      }
    },
    {
      name: "nextjs-app",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      instances: 1,
      exec_mode: "fork",
      node_args: "--max-old-space-size=512",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      }
    }
  ]
};
```

### Start Services
```bash
pm2 start ecosystem.config.js
```

## 5. Memory Configuration

To prevent OOM errors, the processes are constrained using the following flags:

- **Lead Workers**: `--max-old-space-size=768`
- **Next.js App**: `--max-old-space-size=512`

PM2 is also configured with `max_memory_restart` to auto-recycle processes that exceed safe thresholds.

## 6. Logging

Logs are written to the `./logs` directory as defined in the ecosystem configuration:
- `logs/workers-error.log`
- `logs/nextjs-error.log`

---

For troubleshooting common issues, refer to the [Troubleshooting Guide](./TROUBLESHOOTING.md).