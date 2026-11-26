import { EventEmitter } from "events";
import sinon from "sinon";
import { expect } from "chai";
import amqp from "amqplib";
import { Server, TaskFatalError } from "../src/server.js";
import { RabbitMQ } from "../src/rabbitmq.js";
import type { MessageActions } from "../src/rabbitmq.js";
import { PonosWorker } from "../src/worker.js";
import type { WorkerData } from "../src/worker.js";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Server", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("with stubbed RabbitMQ transport", () => {
    beforeEach(() => {
      sandbox.stub(RabbitMQ.prototype, "connect").resolves();
      sandbox.stub(RabbitMQ.prototype, "consume").resolves();
      sandbox.stub(RabbitMQ.prototype, "subscribeToQueue").resolves();
      sandbox.stub(RabbitMQ.prototype, "unsubscribe").resolves();
      sandbox.stub(RabbitMQ.prototype, "disconnect").resolves();
    });

    describe("constructor & setTask", () => {
      it("should initialize server with default empty tasks and options", () => {
        const server = new Server();
        expect(server).to.be.an.instanceof(Server);
      });

      it("should initialize server with tasks", () => {
        const taskFn = async () => {};
        const tasksMap = new Map([["queue1", taskFn]]);
        const server = new Server(tasksMap);
        expect(server).to.be.an.instanceof(Server);
      });

      it("should validate concurrency and worker options eagerly", () => {
        expect(() => new Server(new Map(), { concurrency: 0 })).to.throw(
          RangeError,
        );
        expect(() => new Server(new Map(), { concurrency: 1.5 })).to.throw(
          RangeError,
        );
        expect(() => new Server(new Map(), { maxRetries: -1 })).to.throw(
          RangeError,
        );
      });

      it("should allow setting tasks via setTask and preserve existing workQueue", () => {
        const taskFn1 = async () => {};
        const taskFn2 = async () => {};
        const server = new Server(new Map([["q2", taskFn1]]));
        const existingQueue = (server as any).workQueues.get("q2");
        existingQueue.push({
          handler: taskFn1,
          job: { message: "queued" },
          jobMeta: {},
          actions: { ack: () => {}, nack: () => {} },
        });

        const result = server.setTask("q2", taskFn2);
        expect(result).to.equal(server);
        expect((server as any).workQueues.get("q2")).to.equal(existingQueue);
        expect((server as any).workQueues.get("q2")).to.have.lengthOf(1);
      });
    });

    describe("start & stop", () => {
      it("should start server and subscribe to queues", async () => {
        const taskFn = async () => {};
        const server = new Server(new Map([["q1", taskFn]]));

        await server.start();

        sinon.assert.calledOnce(RabbitMQ.prototype.connect as sinon.SinonStub);
        sinon.assert.calledOnce(
          RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub,
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
          RabbitMQ.prototype.unsubscribe as sinon.SinonStub,
        );
        sinon.assert.calledOnce(
          RabbitMQ.prototype.disconnect as sinon.SinonStub,
        );
      });

      it("should log and rethrow error on stop failure", async () => {
        sandbox.stub(console, "error");
        const err = new Error("Stop failed");
        (RabbitMQ.prototype.unsubscribe as sinon.SinonStub).rejects(err);

        const server = new Server(new Map());
        await expect(server.stop()).to.be.rejectedWith("Stop failed");
      });

      it("should re-subscribe queues when restarted after stop", async () => {
        const server = new Server(new Map([["q1", async () => {}]]));
        await server.start();
        await server.stop();
        await server.start();

        sinon.assert.calledTwice(
          RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub,
        );
      });
    });

    describe("queue message handling & execution", () => {
      it("should process enqueued job via PonosWorker with options and call ack", async () => {
        let subscribeCallback:
          | ((job: any, jobMeta: object, actions: MessageActions) => void)
          | null = null;
        (RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub).callsFake(
          (_queue: string, cb: any) => {
            subscribeCallback = cb;
            return Promise.resolve();
          },
        );

        const workerInstance = {
          run: sandbox.stub().resolves(),
        };
        sandbox.stub(PonosWorker, "create").returns(workerInstance as any);

        const taskHandler = sandbox.stub().resolves();
        const server = new Server(new Map([["q1", taskHandler]]), {
          taskTimeoutMs: 5000,
          maxRetries: 2,
          initialRetryDelayMs: 250,
          maxRetryDelayMs: 2000,
        });

        await server.start();

        const actions: MessageActions = {
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        };
        const jobData = { message: "hello" };
        const jobMeta = { correlationId: "c-1" };

        subscribeCallback!(jobData, jobMeta, actions);

        await new Promise((resolve) => setTimeout(resolve, 10));

        sinon.assert.calledOnce(PonosWorker.create as sinon.SinonStub);
        sinon.assert.calledWithExactly(
          PonosWorker.create as sinon.SinonStub,
          0,
          jobData,
          "q1",
          taskHandler,
          {
            taskTimeoutMs: 5000,
            maxRetries: 2,
            initialRetryDelayMs: 250,
            maxRetryDelayMs: 2000,
            jobMeta,
          },
        );
        sinon.assert.calledOnce(workerInstance.run);
        sinon.assert.calledOnce(actions.ack as sinon.SinonStub);
        sinon.assert.notCalled(actions.nack as sinon.SinonStub);
      });

      it("should call onError and nack(false) when worker.run rejects", async () => {
        let subscribeCallback:
          | ((job: any, jobMeta: object, actions: MessageActions) => void)
          | null = null;
        (RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub).callsFake(
          (_queue: string, cb: any) => {
            subscribeCallback = cb;
            return Promise.resolve();
          },
        );

        const runError = new Error("worker exploded");
        const workerInstance = {
          run: sandbox.stub().rejects(runError),
        };
        sandbox.stub(PonosWorker, "create").returns(workerInstance as any);

        const onError = sandbox.stub();
        const server = new Server(new Map([["q1", async () => {}]]), {
          onError,
        });

        await server.start();

        const actions: MessageActions = {
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        };
        subscribeCallback!({ message: "fail" }, {}, actions);

        await new Promise((resolve) => setTimeout(resolve, 10));

        sinon.assert.calledOnceWithExactly(onError, runError);
        sinon.assert.calledOnceWithExactly(
          actions.nack as sinon.SinonStub,
          false,
        );
        sinon.assert.notCalled(actions.ack as sinon.SinonStub);
      });

      it("should call onError and nack(false) when task is missing on delivery", async () => {
        const onError = sandbox.stub();
        const server = new Server(new Map(), { onError });
        let subscribeCallback:
          | ((job: any, jobMeta: object, actions: MessageActions) => void)
          | null = null;
        (RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub).callsFake(
          (_queue: string, cb: any) => {
            subscribeCallback = cb;
            return Promise.resolve();
          },
        );

        (server as any).tasks.set("q-missing", async () => {});
        await server.start();

        (server as any).tasks.delete("q-missing");
        const actions: MessageActions = {
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        };
        subscribeCallback!({}, {}, actions);

        sinon.assert.calledOnce(onError);
        expect(onError.firstCall.args[0].message).to.include("q-missing");
        sinon.assert.calledOnceWithExactly(
          actions.nack as sinon.SinonStub,
          false,
        );
        sinon.assert.notCalled(actions.ack as sinon.SinonStub);
      });

      it("should initialize workQueue array if missing when enqueuing", async () => {
        const server = new Server(new Map());
        const actions: MessageActions = {
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        };
        const taskHandler = sandbox.stub().resolves();

        (server as any).workQueues.delete("new-q");
        (server as any).enqueue(
          "new-q",
          taskHandler,
          { message: "test" },
          {},
          actions,
        );

        await new Promise((resolve) => setTimeout(resolve, 10));
        sinon.assert.calledOnce(actions.ack as sinon.SinonStub);
      });

      it("should process jobs strictly sequentially in FIFO order when concurrency is 1", async () => {
        let subscribeCallback:
          | ((job: any, jobMeta: object, actions: MessageActions) => void)
          | null = null;
        (RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub).callsFake(
          (_queue: string, cb: any) => {
            subscribeCallback = cb;
            return Promise.resolve();
          },
        );

        const events: string[] = [];
        const gates: Record<string, ReturnType<typeof createDeferred>> = {
          j1: createDeferred(),
          j2: createDeferred(),
          j3: createDeferred(),
        };

        const server = new Server(
          new Map([
            [
              "fifo-q",
              async (job: WorkerData) => {
                events.push(`${job.message}-start`);
                await gates[job.message].promise;
                events.push(`${job.message}-end`);
              },
            ],
          ]),
        );

        await server.start();

        const makeActions = (): MessageActions => ({
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        });
        const a1 = makeActions();
        const a2 = makeActions();
        const a3 = makeActions();

        subscribeCallback!({ message: "j1" }, {}, a1);
        subscribeCallback!({ message: "j2" }, {}, a2);
        subscribeCallback!({ message: "j3" }, {}, a3);

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(events).to.deep.equal(["j1-start"]);
        sinon.assert.notCalled(a1.ack as sinon.SinonStub);

        gates.j1.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(events).to.deep.equal(["j1-start", "j1-end", "j2-start"]);
        sinon.assert.calledOnce(a1.ack as sinon.SinonStub);

        gates.j2.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(events).to.deep.equal([
          "j1-start",
          "j1-end",
          "j2-start",
          "j2-end",
          "j3-start",
        ]);
        sinon.assert.calledOnce(a2.ack as sinon.SinonStub);

        gates.j3.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(events).to.deep.equal([
          "j1-start",
          "j1-end",
          "j2-start",
          "j2-end",
          "j3-start",
          "j3-end",
        ]);
        sinon.assert.calledOnce(a3.ack as sinon.SinonStub);
      });

      it("should enforce bounded concurrency > 1", async () => {
        let subscribeCallback:
          | ((job: any, jobMeta: object, actions: MessageActions) => void)
          | null = null;
        (RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub).callsFake(
          (_queue: string, cb: any) => {
            subscribeCallback = cb;
            return Promise.resolve();
          },
        );

        const started: string[] = [];
        const gates: Record<string, ReturnType<typeof createDeferred>> = {
          j1: createDeferred(),
          j2: createDeferred(),
          j3: createDeferred(),
        };

        const server = new Server(
          new Map([
            [
              "conc-q",
              async (job: WorkerData) => {
                started.push(job.message);
                await gates[job.message].promise;
              },
            ],
          ]),
          { concurrency: 2 },
        );

        await server.start();

        const actions = () => ({ ack: sandbox.stub(), nack: sandbox.stub() });
        subscribeCallback!({ message: "j1" }, {}, actions());
        subscribeCallback!({ message: "j2" }, {}, actions());
        subscribeCallback!({ message: "j3" }, {}, actions());

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(started).to.deep.equal(["j1", "j2"]);

        gates.j1.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(started).to.deep.equal(["j1", "j2", "j3"]);

        gates.j2.resolve();
        gates.j3.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      it("should drain in-flight jobs and requeue buffered jobs before disconnecting on stop()", async () => {
        let subscribeCallback:
          | ((job: any, jobMeta: object, actions: MessageActions) => void)
          | null = null;
        (RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub).callsFake(
          (_queue: string, cb: any) => {
            subscribeCallback = cb;
            return Promise.resolve();
          },
        );

        const gate1 = createDeferred();
        const server = new Server(
          new Map([
            [
              "drain-q",
              async () => {
                await gate1.promise;
              },
            ],
          ]),
        );

        await server.start();

        const a1: MessageActions = {
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        };
        const a2: MessageActions = {
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        };
        const aLate: MessageActions = {
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        };

        subscribeCallback!({ message: "j1" }, {}, a1);
        subscribeCallback!({ message: "j2" }, {}, a2);
        await new Promise((resolve) => setTimeout(resolve, 10));

        const stopPromise = server.stop();
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Unstarted buffered job should be requeued immediately, while disconnect waits for j1.
        sinon.assert.calledOnceWithExactly(a2.nack as sinon.SinonStub, true);
        sinon.assert.notCalled(
          RabbitMQ.prototype.disconnect as sinon.SinonStub,
        );

        // Any message delivered mid-stop should also be requeued immediately.
        subscribeCallback!({ message: "late" }, {}, aLate);
        sinon.assert.calledOnceWithExactly(aLate.nack as sinon.SinonStub, true);

        gate1.resolve();
        await stopPromise;

        sinon.assert.calledOnce(a1.ack as sinon.SinonStub);
        sinon.assert.calledOnce(
          RabbitMQ.prototype.disconnect as sinon.SinonStub,
        );
      });

      it("should nack(false) when retries are exhausted or TaskFatalError is thrown", async () => {
        let subscribeCallback:
          | ((job: any, jobMeta: object, actions: MessageActions) => void)
          | null = null;
        (RabbitMQ.prototype.subscribeToQueue as sinon.SinonStub).callsFake(
          (_queue: string, cb: any) => {
            subscribeCallback = cb;
            return Promise.resolve();
          },
        );

        const onError = sandbox.stub();
        let calls = 0;
        const server = new Server(
          new Map([
            [
              "retry-q",
              async (job: WorkerData) => {
                calls += 1;
                if (job.message === "fatal") {
                  throw new TaskFatalError("fatal");
                }
                if (calls === 1) {
                  throw new Error("transient");
                }
              },
            ],
          ]),
          { maxRetries: 1, initialRetryDelayMs: 5, onError },
        );

        await server.start();

        const transientActions: MessageActions = {
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        };
        subscribeCallback!({ message: "ok-on-retry" }, {}, transientActions);
        await new Promise((resolve) => setTimeout(resolve, 30));

        sinon.assert.calledOnce(transientActions.ack as sinon.SinonStub);
        sinon.assert.notCalled(onError);

        const fatalActions: MessageActions = {
          ack: sandbox.stub(),
          nack: sandbox.stub(),
        };
        subscribeCallback!({ message: "fatal" }, {}, fatalActions);
        await new Promise((resolve) => setTimeout(resolve, 20));

        sinon.assert.calledOnceWithExactly(
          fatalActions.nack as sinon.SinonStub,
          false,
        );
        sinon.assert.calledOnce(onError);
        expect(onError.firstCall.args[0]).to.be.an.instanceof(TaskFatalError);
      });
    });
  });

  describe("integration with RabbitMQ transport & ServerOptions", () => {
    let fakeChannel: any;
    let fakeConfirmChannel: any;
    let fakeConnection: any;

    beforeEach(() => {
      fakeChannel = Object.assign(new EventEmitter(), {
        assertQueue: sandbox.stub().resolves(),
        prefetch: sandbox.stub().resolves(),
        consume: sandbox.stub().resolves({ consumerTag: "tag-123" }),
        ack: sandbox.stub(),
        nack: sandbox.stub(),
        cancel: sandbox.stub().resolves(),
      });
      fakeConfirmChannel = Object.assign(new EventEmitter(), {
        sendToQueue: sandbox.stub(),
        waitForConfirms: sandbox.stub().resolves(),
      });
      fakeConnection = Object.assign(new EventEmitter(), {
        createChannel: sandbox.stub().resolves(fakeChannel),
        createConfirmChannel: sandbox.stub().resolves(fakeConfirmChannel),
        close: sandbox.stub().resolves(),
      });
      sandbox.stub(amqp, "connect").resolves(fakeConnection as any);
    });

    it("should forward ServerOptions to RabbitMQ and default prefetch to concurrency", async () => {
      const server = new Server(new Map([["invoice", async () => {}]]), {
        name: "billing",
        concurrency: 3,
      });

      await server.start();

      sinon.assert.calledOnceWithExactly(fakeChannel.prefetch, 3);
      sinon.assert.calledOnceWithExactly(
        fakeChannel.assertQueue,
        "billing.invoice",
      );
    });

    it("should forward ServerOptions to RabbitMQ and assert tasks added via setTask before start", async () => {
      const onError = sandbox.stub();
      const server = new Server(new Map(), {
        name: "billing",
        rabbitmq: {
          protocol: "amqps",
          hostname: "broker.internal",
          username: "worker",
          password: "s@fe:pass/word",
          vhost: "/billing",
        },
        prefetch: 4,
        onError,
      });

      server.setTask("invoice", async () => {});
      await server.start();

      expect((amqp.connect as sinon.SinonStub).firstCall.args[0]).to.deep.equal(
        {
          protocol: "amqps",
          hostname: "broker.internal",
          port: 5671,
          username: "worker",
          password: "s@fe:pass/word",
          vhost: "/billing",
        },
      );
      sinon.assert.calledOnceWithExactly(fakeChannel.prefetch, 4);
      sinon.assert.calledOnceWithExactly(
        fakeChannel.assertQueue,
        "billing.invoice",
      );
      sinon.assert.calledWith(fakeChannel.consume, "billing.invoice");
    });

    it("should assert and consume queues added via setTask after start when consume is called", async () => {
      const server = new Server(new Map([["initial", async () => {}]]));
      await server.start();

      sinon.assert.calledOnceWithExactly(
        fakeChannel.assertQueue,
        "ponos.initial",
      );
      sinon.assert.calledOnce(fakeChannel.consume);

      server.setTask("dynamic", async () => {});
      await server.consume();

      sinon.assert.calledTwice(fakeChannel.assertQueue);
      sinon.assert.calledWithExactly(
        fakeChannel.assertQueue.secondCall,
        "ponos.dynamic",
      );
      sinon.assert.calledTwice(fakeChannel.consume);
      sinon.assert.calledWith(
        fakeChannel.consume.secondCall,
        "ponos.dynamic",
      );
    });
  });
});
