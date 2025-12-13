"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logMemoryUsage = logMemoryUsage;
exports.setupMemoryMonitoring = setupMemoryMonitoring;
// src/lib/monitoring.ts
function logMemoryUsage(workerId) {
    const used = process.memoryUsage();
    console.log(`📊 Worker ${workerId} Memory Usage:`);
    console.log(`   RSS: ${Math.round(used.rss / 1024 / 1024)} MB`);
    console.log(`   Heap Total: ${Math.round(used.heapTotal / 1024 / 1024)} MB`);
    console.log(`   Heap Used: ${Math.round(used.heapUsed / 1024 / 1024)} MB`);
    console.log(`   External: ${Math.round(used.external / 1024 / 1024)} MB`);
}
function setupMemoryMonitoring(workerId, intervalMs = 30000) {
    setInterval(() => {
        logMemoryUsage(workerId);
        // Trigger garbage collection if memory is high
        const used = process.memoryUsage();
        const heapUsedMB = used.heapUsed / 1024 / 1024;
        if (heapUsedMB > 300 && global.gc) {
            console.log(`⚠️ Worker ${workerId}: High memory usage, triggering GC`);
            global.gc();
        }
    }, intervalMs);
}
