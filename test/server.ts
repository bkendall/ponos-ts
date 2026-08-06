import sinon from "sinon";
import { expect } from "chai";
import { Server } from "../src/server.js";
import { RabbitMQ } from "../src/rabbitmq.js";
import { PonosWorker } from "../src/worker.js";

describe("Server", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(RabbitMQ.prototype, "connect").resolves();
    sandbox.stub(RabbitMQ.prototype, "consume").resolves();
    sandbox.stub(RabbitMQ.prototype, "subscribeToQueue").resolves();
    sandbox.stub(RabbitMQ.prototype, "unsubscribe").resolves();
    sandbox.stub(RabbitMQ.prototype, "disconnect").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("constructor & setTask", () => {
    it("should initialize server with tasks", () => {
      const taskFn = async () => {};
      const tasksMap = new Map([["queue1", taskFn]]);
      const server = new Server(tasksMap);
      expect(server).to.be.an.instanceof(Server);
    });

    it("should allow setting tasks via setTask", () => {
      const server = new Server(new Map());
      const taskFn = async () => {};
      const result = server.setTask("q2", taskFn);
      expect(result).to.equal(server);
    });
  });

  describe("start & stop", () => {
    it("should start server and subscribe to queues", async () => {
      const taskFn = async () => {};
      const server = new Server(new Map([["q1", taskFn]]));

      await server.start();

      sinon.assert.calledOnce(RabbitMQ.prototype.connect as sinon.SinonStub);
      sinon.assert.calledOnce(
        RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub
      );
      sinon.assert.calledOnce(RabbitMQ.prototype.consume as sinon.SinonStub);
    });

    it("should log and rethrow error on start failure", async () => {
      sandbox.stub(console, "error");
      const err = new Error("Connect failed");
      (RabbitMQ.prototype.connect as sinon.SinonStub).rejects(err);

      const server = new Server(new Map());
      await expect(server.start()).to.be.rejectedWith("Connect failed");
    });

    it("should stop server successfully", async () => {
      const server = new Server(new Map());
      await server.stop();

      sinon.assert.calledOnce(
        RabbitMQ.prototype.unsubscribe as sinon.SinonStub
      );
      sinon.assert.calledOnce(
        RabbitMQ.prototype.disconnect as sinon.SinonStub
      );
    });

    it("should log and rethrow error on stop failure", async () => {
      sandbox.stub(console, "error");
      const err = new Error("Stop failed");
      (RabbitMQ.prototype.unsubscribe as sinon.SinonStub).rejects(err);

      const server = new Server(new Map());
      await expect(server.stop()).to.be.rejectedWith("Stop failed");
    });
  });

  describe("queue message handling & execution", () => {
    it("should process enqueued job via PonosWorker and call done", async () => {
      let subscribeCallback: Function | null = null;
      (
        RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub
      ).callsFake((queue: string, cb: Function) => {
        subscribeCallback = cb;
        return Promise.resolve();
      });

      const workerInstance = {
        run: sandbox.stub().resolves(),
      };
      sandbox.stub(PonosWorker, "create").returns(workerInstance as any);

      const taskHandler = sandbox.stub().resolves();
      const server = new Server(new Map([["q1", taskHandler]]));

      await server.start();

      const doneStub = sandbox.stub();
      const jobData = { message: "hello" };
      const jobMeta = {};

      subscribeCallback!(jobData, jobMeta, doneStub);

      await new Promise((resolve) => setTimeout(resolve, 10));

      sinon.assert.calledOnce(PonosWorker.create as sinon.SinonStub);
      sinon.assert.calledWith(
        PonosWorker.create as sinon.SinonStub,
        0,
        jobData,
        "q1",
        taskHandler
      );
      sinon.assert.calledOnce(workerInstance.run);
      sinon.assert.calledOnce(doneStub);
    });

    it("should handle missing queue in workQueues or missing task in enqueue", async () => {
      const server = new Server(new Map());
      let subscribeCallback: Function | null = null;
      (
        RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub
      ).callsFake((queue: string, cb: Function) => {
        subscribeCallback = cb;
        return Promise.resolve();
      });

      (server as any).tasks.set("q-missing", async () => {});
      await server.start();

      (server as any).tasks.delete("q-missing");
      const doneStub = sandbox.stub();
      subscribeCallback!({}, {}, doneStub);

      expect(doneStub.called).to.be.false;
    });

    it("should initialize workQueue array if missing when enqueuing", async () => {
      const server = new Server(new Map());
      const doneStub = sandbox.stub();
      const taskHandler = sandbox.stub().resolves();

      (server as any).workQueues.delete("new-q");
      (server as any).enqueue("new-q", taskHandler, { message: "test" }, {}, doneStub);

      await new Promise((resolve) => setTimeout(resolve, 10));
      sinon.assert.calledOnce(doneStub);
    });
  });
});
