// Mock pg-boss ES module for Jest
import { EventEmitter } from 'events';

export default class PgBoss extends EventEmitter {
    constructor() {
        super();
    }

    async start() {
        return this;
    }

    async stop() {
        return;
    }

    async createQueue(queueName: string) {
        return;
    }

    async send(queueName: string, payload: any, options?: any) {
        return `mock-job-${Date.now()}`;
    }

    async work(queueName: string, handler: any) {
        return;
    }

    async fetch(queueName: string) {
        return null;
    }

    async complete(jobId: string) {
        return;
    }

    async fail(jobId: string, error: any) {
        return;
    }
}

export { PgBoss };
