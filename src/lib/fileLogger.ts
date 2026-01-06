// src/lib/fileLogger.ts
import winston from 'winston';
import path from 'path';

// Create logs directory at project root
const logsDir = path.join(process.cwd(), 'logs');

// Custom format for better readability
const customFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
        return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
    })
);

// Create winston logger
export const fileLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: customFormat,
    transports: [
        // Error log - only errors
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 5,
        }),
        // Combined log - all levels
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
        }),
        // Worker log - specific for worker activity
        new winston.transports.File({
            filename: path.join(logsDir, 'workers.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
        }),
        // Console output (existing behavior)
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                customFormat
            ),
        }),
    ],
});

// Helper to log worker-specific events
export function logWorkerEvent(workerId: number, event: string, data?: Record<string, unknown>) {
    fileLogger.info(`[Worker ${workerId}] ${event}`, data);
}

// Helper to log GHL API errors
export function logGHLError(context: string, error: Record<string, unknown>) {
    fileLogger.error(`GHL API Error - ${context}`, {
        status: error.status,
        statusText: error.statusText,
        message: error.errorMessage || error.message,
        data: error.data,
    });
}

// Helper to log job failures
export function logJobFailure(jobId: string, error: string, metadata?: Record<string, unknown>) {
    fileLogger.error(`Job Failed: ${jobId}`, {
        error,
        ...metadata,
    });
}

export default fileLogger;
