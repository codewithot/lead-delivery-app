# API Documentation

The Lead Delivery App provides several API endpoints for lead ingestion, job management, and user settings.

## Authentication

Most endpoints require an active session via NextAuth.js. Webhook endpoints use a secret header.

---

## Webhooks

### Ingest Complete
`POST /api/ingest-complete`

Triggered when external lead ingestion is finished to start the delivery process.

**Authentication**: Header `x-hook-secret`
**Payload**:
```json
{
  "runId": "string",
  "ingestedAt": "ISO-8601-date-string"
}
```
**Response**: `200 OK` on success, `401 Unauthorized` if secret is wrong, `400 Bad Request` if payload is invalid.

---

## Leads & Jobs

### List Jobs
`GET /api/jobs`
Returns a list of recent delivery jobs.

### Retry Job
`POST /api/jobs/[id]/retry`
Retries a specific failed job.

### Bulk Retry
`POST /api/jobs/retry-bulk`
Retries all failed jobs within a given timeframe.

---

## User & Settings

### Get/Update Settings
`GET/POST /api/user-settings`
Manage lead delivery criteria (Zip codes, price range, etc.) for the authenticated user.

### Plan Usage
`GET /api/plan-usage`
Returns current lead consumption relative to the user's plan limit.

### OAuth Connect
`/api/auth/gh` (Initiated via NextAuth)
Redirects user to GHL Marketplace for authorization.

---

## Monitoring

### Worker Health
`GET /api/workers/health`
Returns health status and metrics of active worker processes.
