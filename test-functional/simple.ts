import { expect } from "chai";
import { EventEmitter } from "events";
import Promise from "bluebird";
import { RabbitMQ } from "../src/rabbitmq.js";
import { Server } from "../src/index.js";
import type { WorkerData, WorkerFunction } from "../src/index.js";


describe("Simple Example", () => {
  let server: Server;
  let rabbitmq: RabbitMQ;
  const jobEmitter: EventEmitter = new EventEmitter();
  const basicWorker: WorkerFunction = (job: WorkerData): Promise<void> => {
    return Promise.try(() => {
      console.log("worker got it");
      jobEmitter.emit("done");
    });
  };

  before(() => {
    rabbitmq = new RabbitMQ({
      name: "ponos",
      tasks: new Set(["basic-queue-worker"]),
    });
    return rabbitmq.connect();
  });

  it("should call our basic worker", () => {
    server = new Server(new Map([["basic-queue-worker", basicWorker]]));
    const jobPromise = Promise.fromCallback((done) => {
      console.log("waiting for emit");
      jobEmitter.on("done", () => {
        done(null, "");
      });
    });
    return server
      .start()
      .then(() => {
        console.log("waiting for publish");
        return rabbitmq.publishTask("basic-queue-worker", {});
      })
      .then(() => {
        console.log("waiting on promise");
        return jobPromise;
      })
      .then(() => {
        return expect(jobPromise).to.eventually.be.fulfilled;
      })
      .catch((err: unknown) => {
        console.error(err);
        throw err;
      })
      .finally(() => {
        return Promise.all([rabbitmq.disconnect(), server.stop()]);
      });
  });
});

