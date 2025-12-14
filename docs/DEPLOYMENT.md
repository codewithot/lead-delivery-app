# Deployment Guide

## Memory Configuration

The application is configured with the following memory limits to prevent OOM (Out of Memory) errors:

### Worker Processes
- **Memory Limit**: 768 MB (`--max-old-space-size=768`)
- **Max Memory Restart**: 800 MB (PM2 auto-restart threshold)
- **Garbage Collection**: Exposed via `--expose-gc` flag

### Next.js Application
- **Memory Limit**: 512 MB
- **Max Memory Restart**: 600 MB

## Running Workers

### Development
```bash
# Run workers with memory limits (TypeScript)
npm run workers
```

### Production
```bash
# Build workers first
npm run build:workers

# Run compiled workers with memory limits
npm run worker:prod
```

### Using PM2 (Recommended for Production)
```bash
# Install PM2 globally
npm install -g pm2

# Start all services
pm2 start ecosystem.config.js

# Monitor processes
pm2 monit

# View logs
pm2 logs lead-workers

# Restart workers
pm2 restart lead-workers

# Stop all
pm2 stop all

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```

## Monitoring Memory Usage

The application includes built-in memory monitoring:
```typescript
// Logs memory every 30 seconds
setupMemoryMonitoring(workerId, 30000);
```

### Memory Logs Show:
- **RSS** (Resident Set Size): Total memory allocated
- **Heap Total**: Total heap size
- **Heap Used**: Currently used heap
- **External**: C++ objects bound to JavaScript

### Automatic Garbage Collection
When heap usage exceeds 300 MB, the system triggers manual GC (if `--expose-gc` is enabled).

## Environment Variables
```bash
# Worker configuration
WORKER_COUNT=10                 # Number of concurrent workers
JOB_CONCURRENCY=10             # Jobs per worker
REGION_TZ=America/New_York     # Timezone for scheduling

# Memory monitoring
MEMORY_ALERT_THRESHOLD=600     # Alert when RSS exceeds (MB)

# Database
DATABASE_URL=postgresql://...
JOB_PG_POOL_MAX=10            # Database connection pool size
```

## Troubleshooting

### Out of Memory Errors
If you see `FATAL ERROR: Reached heap limit`:
1. Check current memory limits: `node --v8-options | grep max-old-space-size`
2. Increase `--max-old-space-size` if needed (current: 768 MB)
3. Review `max_memory_restart` in PM2 config

### High Memory Usage
1. Check PM2 dashboard: `pm2 monit`
2. View detailed memory: `pm2 show lead-workers`
3. Restart if needed: `pm2 restart lead-workers`

### Memory Leaks
1. Enable heap snapshots in PM2:
```bash
   pm2 install pm2-heapdump
   pm2 heapdump lead-workers
```
2. Analyze with Chrome DevTools

## Manual Queue Provisioning
```bash
# Trigger manual queue provision
npm run provision-queues
```

## Scheduled Provisioning

Workers automatically provision daily queues at:
- **06:00 EST** - Main provision
- **06:10 EST** - Retry #1
- **06:20 EST** - Retry #2

No additional cron setup needed - the scheduler runs inside the worker process.
```

## 6. Create `.gitignore` entry for logs

Add to your `.gitignore`:
```
# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# PM2
.pm2/