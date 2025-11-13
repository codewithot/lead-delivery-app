// src/workers/master.ts
import { WorkerManager } from "../lib/workerManager";
import { closeQueue } from "../lib/queue";

const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || "10", 10);

class MasterProcess {
  private workers: WorkerManager[] = [];
  private isShuttingDown: boolean = false;

  async start() {
    console.log(`🎯 Starting ${WORKER_COUNT} workers...`);

    // Create and start all workers
    for (let i = 1; i <= WORKER_COUNT; i++) {
      const worker = new WorkerManager(i);
      this.workers.push(worker);
      await worker.start();
    }

    console.log(`✅ All ${WORKER_COUNT} workers started successfully`);

    // Setup graceful shutdown
    this.setupGracefulShutdown();

    // Keep process alive
    process.stdin.resume();
  }

  private setupGracefulShutdown() {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) {
        console.log("⚠️ Already shutting down...");
        return;
      }

      this.isShuttingDown = true;
      console.log(`\n📢 Received ${signal}, starting graceful shutdown...`);

      try {
        // Stop all workers
        console.log("🛑 Stopping workers...");
        await Promise.all(this.workers.map((w) => w.stop()));

        // Close queue
        console.log("🛑 Closing queue...");
        await closeQueue();

        console.log("✅ Graceful shutdown complete");
        process.exit(0);
      } catch (error) {
        console.error("❌ Error during shutdown:", error);
        process.exit(1);
      }
    };

    // Handle different termination signals
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGUSR2", () => shutdown("SIGUSR2"));

    // Handle uncaught errors
    process.on("uncaughtException", (error) => {
      console.error("💥 Uncaught Exception:", error);
      shutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
      shutdown("unhandledRejection");
    });
  }

  getStatus() {
    return {
      totalWorkers: WORKER_COUNT,
      workers: this.workers.map((w) => w.getStatus()),
      isShuttingDown: this.isShuttingDown,
    };
  }
}

// Start the master process
const master = new MasterProcess();
master.start().catch((error) => {
  console.error("💥 Failed to start master process:", error);
  process.exit(1);
});

export { master };
