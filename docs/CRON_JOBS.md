# Cron Job Configuration

This document provides exact configurations for scheduled tasks.

## 1. Internal Scheduler (Primary)

The application includes an internal scheduler (`node-cron`) running in the `lead-workers` process. It handles provisioning automatically based on the `REGION_TZ` environment variable.

### Built-in Schedule
| Time (EST) | Task | Logic |
|------------|------|-------|
| `06:00` | Main Provision | Scans all users and creates daily delivery queues. |
| `06:10` | Retry #1 | Re-runs provisioning for any failed users or missed queues. |
| `06:20` | Retry #2 | Final retry for robust queue creation. |

## 2. System Crontab (Backup/Alternative)

If you prefer using the system crontab (`crontab -e`), use the following exact entries. 

> [!IMPORTANT]
> Change `/home/deploy/lead-delivery-app` to your actual absolute application deployment path.
> Change `/usr/bin/npm` to the path returned by `which npm`.

### Crontab Entries

```bash
# Provision queues daily at 06:00 EST
0 6 * * * cd /home/deploy/lead-delivery-app && /usr/bin/npm run provision-queues >> /home/deploy/lead-delivery-app/logs/cron-provision.log 2>&1

# (Optional) Cleanup old logs every Sunday at 00:00
0 0 * * 0 find /home/deploy/lead-delivery-app/logs -name "*.log" -mtime +7 -delete
```

## 3. Manual Provisioning

Directly trigger the provisioning logic from the terminal:

```bash
npm run provision-queues
```
