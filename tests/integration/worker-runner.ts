
import { runWorker } from "../../src/lib/worker";

console.log("Worker runner starting...");
console.log("DB URL present:", !!process.env.DATABASE_URL);

// Execute worker logic

// Execute worker logic
runWorker().then(() => {
    console.log("Worker runner finished successfully");
}).catch(err => {
    console.error("Worker Execution Error:", err);
    process.exit(1);
});
