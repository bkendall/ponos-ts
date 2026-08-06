import { Server } from "../src/index.js";
import type { WorkerData, WorkerFunction } from "../src/index.js";

const basicWorker: WorkerFunction = async (job: WorkerData): Promise<void> => {
  if (!job.message) {
    throw new Error("message is required");
  }
  console.log(`hello world: ${job.message}`);
};

const tasks = new Map<string, WorkerFunction>([
  ["basic-queue-worker", basicWorker],
]);
const server = new Server(tasks);

server
  .start()
  .then(() => {
    console.log("server started");
  })
  .catch((err: unknown) => {
    console.error(`server error: ${err}`);
  });

process.on("SIGINT", () => {
  server
    .stop()
    .then(() => {
      console.log("server stopped");
    })
    .catch((err: unknown) => {
      console.error(`server stop error: ${err}`);
    });
});

