import { expect } from "chai";
import { EventEmitter } from "events";
import { RabbitMQ } from "../src/rabbitmq.js";
import { Server } from "../src/index.js";
import type { WorkerData, WorkerFunction } from "../src/index.js";

describe("Simple Example", () => {
  let server: Server;
  let rabbitmq: RabbitMQ;
  const jobEmitter: EventEmitter = new EventEmitter();
  const basicWorker: WorkerFunction = async (_job: WorkerData): Promise<void> => {
    console.log("worker got it");
    jobEmitter.emit("done");
  };

  before(() => {
    rabbitmq = new RabbitMQ({
      name: "ponos",
      tasks: new Set(["basic-queue-worker"]),
    });
    return rabbitmq.connect();
  });

  it("should call our basic worker", async () => {
    server = new Server(new Map([["basic-queue-worker", basicWorker]]));
    const jobPromise = new Promise<void>((resolve) => {
      console.log("waiting for emit");
      jobEmitter.on("done", () => {
        resolve();
      });
    });
    try {
      await server.start();
      console.log("waiting for publish");
      await rabbitmq.publishTask("basic-queue-worker", {});
      console.log("waiting on promise");
      await jobPromise;
      await expect(jobPromise).to.eventually.be.fulfilled;
    } catch (err: unknown) {
      console.error(err);
      throw err;
    } finally {
      await Promise.all([rabbitmq.disconnect(), server.stop()]);
    }
  });
});


