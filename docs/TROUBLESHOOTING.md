# Troubleshooting Guide

This guide provides solutions to common issues encountered while running the Lead Delivery App.

## 1. Authentication & OAuth Issues

### "Invalid stored GHL credentials"
- **Cause**: The user's OAuth tokens are missing or have become completely invalid (refresh token expired).
- **Solution**: The user must reconnect their GoHighLevel account through the dashboard settings page.

### "NextAuth: [jwt] Token update error"
- **Cause**: Database connection issue or schema mismatch when trying to persist OAuth tokens during login.
- **Selection**: Check the application logs for specific Prisma error messages and verify the `DATABASE_URL`.

## 2. Worker & Job Issues

### Jobs stuck in `pending` or `in_progress`
- **Cause**: 
  - Workers are not running.
  - Workers crashed due to memory limits.
  - Redis connection lost (if using pg-boss with Redis features).
- **Solution**: 
  - Verify workers are active: `pm2 status`.
  - Check worker logs: `pm2 logs lead-workers`.
  - If using standalone workers, ensure `USE_STANDALONE_WORKERS` is `true` only if intended.

### "Cannot read properties of undefined (reading 'createQueue')"
- **Cause**: The `pg-boss` instance (returned by `getQueueInstance()`) is not initialized or failed to connect to the database.
- **Solution**: Check `DATABASE_URL` and ensure Postgres is allowing connections from the application server.

## 3. Webhook Issues

### Webhook returns `401 Unauthorized`
- **Cause**: Missing or incorrect `x-hook-secret` header.
- **Solution**: Ensure your webhook sender is including the correct secret defined in `WEBHOOK_SECRET` environment variable.

### Webhook returns `500 Internal Server Error`
- **Cause**: Database or Queue initialization failure.
- **Solution**: Check `logs/nextjs-error.log` for the stack trace. Common causes include missing Prisma client initialization or database connectivity issues.

## 4. Performance & Memory

### FATAL ERROR: Reached heap limit
- **Cause**: Worker process exceeded allocated memory (768MB).
- **Solution**: 
  - Review the batch size (`PROPERTIES_PER_BATCH`).
  - Increase memory limit in `ecosystem.config.js` or `package.json` if the workload consistently exceeds 768MB.
  - Check for memory leaks using `pm2 install pm2-heapdump`.

### Rate Limit Exceeded (429)
- **Cause**: Too many requests to an API endpoint within the time window.
- **Solution**: 
  - Check the `RATE_LIMIT_TIERS` configuration in `src/lib/apiRateLimiter.ts`.
  - For webhooks, the default is 10 requests per minute.
