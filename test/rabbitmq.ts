import { EventEmitter } from "events";
import sinon from "sinon";
import { expect } from "chai";
import amqp from "amqplib";
import { RabbitMQ } from "../src/rabbitmq.js";

const ENV_KEYS = [
  "RABBITMQ_URL",
  "RABBITMQ_PROTOCOL",
  "RABBITMQ_HOSTNAME",
  "RABBITMQ_PORT",
  "RABBITMQ_USERNAME",
  "RABBITMQ_PASSWORD",
  "RABBITMQ_VHOST",
] as const;

describe("RabbitMQ", () => {
  let sandbox: sinon.SinonSandbox;
  let fakeChannel: any;
  let fakeConfirmChannel: any;
  let fakeConnection: any;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

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

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    sandbox.restore();
  });

  describe("constructor & configuration validation", () => {
    it("should initialize with default options", () => {
      const rmq = new RabbitMQ({ name: "", tasks: new Set() });
      expect(rmq).to.be.an.instanceof(RabbitMQ);
    });

    it("should reject invalid prefetch values", () => {
      expect(
        () => new RabbitMQ({ name: "test", tasks: new Set(), prefetch: 0 }),
      ).to.throw(RangeError);
      expect(
        () => new RabbitMQ({ name: "test", tasks: new Set(), prefetch: -2 }),
      ).to.throw(RangeError);
      expect(
        () => new RabbitMQ({ name: "test", tasks: new Set(), prefetch: 1.5 }),
      ).to.throw(RangeError);
    });

    it("should reject unsupported protocols and invalid ports", () => {
      expect(
        () =>
          new RabbitMQ({
            name: "test",
            connection: { protocol: "http" as any },
          }),
      ).to.throw(Error);

      for (const badPort of [0, -1, 65536, 1.5]) {
        expect(
          () =>
            new RabbitMQ({
              name: "test",
              connection: { port: badPort },
            }),
        ).to.throw(RangeError);
      }

      process.env.RABBITMQ_PORT = "not-a-number";
      expect(() => new RabbitMQ({ name: "test" })).to.throw(RangeError);
    });
  });

  describe("connect", () => {
    it("should connect with safe default Options.Connect, set prefetch=1, and never log credentials", async () => {
      const consoleLogStub = sandbox.stub(console, "log");
      const rmq = new RabbitMQ({
        name: "test-app",
        tasks: new Set(["task-a", "task-b"]),
      });

      await rmq.connect();

      sinon.assert.notCalled(consoleLogStub);
      sinon.assert.calledOnce(amqp.connect as sinon.SinonStub);
      expect((amqp.connect as sinon.SinonStub).firstCall.args[0]).to.deep.equal(
        {
          protocol: "amqp",
          hostname: "localhost",
          port: 5672,
          vhost: "/",
        },
      );
      sinon.assert.calledOnceWithExactly(fakeChannel.prefetch, 1);
      sinon.assert.calledTwice(fakeChannel.assertQueue);
      sinon.assert.calledWith(fakeChannel.assertQueue, "test-app.task-a");
      sinon.assert.calledWith(fakeChannel.assertQueue, "test-app.task-b");
    });

    it("should pass env credentials with special characters as Options.Connect without logging", async () => {
      const consoleLogStub = sandbox.stub(console, "log");
      process.env.RABBITMQ_HOSTNAME = "rmq.internal";
      process.env.RABBITMQ_PORT = "5673";
      process.env.RABBITMQ_USERNAME = "svc-user";
      process.env.RABBITMQ_PASSWORD = "p@ss:w/rd#1%";
      process.env.RABBITMQ_VHOST = "/prod";

      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      sinon.assert.notCalled(consoleLogStub);
      expect((amqp.connect as sinon.SinonStub).firstCall.args[0]).to.deep.equal(
        {
          protocol: "amqp",
          hostname: "rmq.internal",
          port: 5673,
          username: "svc-user",
          password: "p@ss:w/rd#1%",
          vhost: "/prod",
        },
      );
    });

    it("should use RABBITMQ_URL when provided and no explicit connection option is given", async () => {
      process.env.RABBITMQ_URL = "amqps://user:pass@broker.example.com/app";
      const rmq = new RabbitMQ({ name: "test" });

      await rmq.connect();

      expect((amqp.connect as sinon.SinonStub).firstCall.args[0]).to.equal(
        "amqps://user:pass@broker.example.com/app",
      );
    });

    it("should support explicit connection string, url object, and amqps default port 5671", async () => {
      const rmqUrlStr = new RabbitMQ({
        name: "test",
        connection: "amqp://custom-host:5672/vh",
      });
      await rmqUrlStr.connect();
      expect((amqp.connect as sinon.SinonStub).firstCall.args[0]).to.equal(
        "amqp://custom-host:5672/vh",
      );

      const rmqUrlObj = new RabbitMQ({
        name: "test",
        connection: { url: "amqps://obj-host/vh" },
      });
      await rmqUrlObj.connect();
      expect((amqp.connect as sinon.SinonStub).secondCall.args[0]).to.equal(
        "amqps://obj-host/vh",
      );

      const rmqTls = new RabbitMQ({
        name: "test",
        prefetch: 5,
        connection: {
          protocol: "amqps",
          hostname: "tls.broker",
          username: "admin",
          password: "",
          vhost: "/secure",
        },
      });
      await rmqTls.connect();
      expect((amqp.connect as sinon.SinonStub).thirdCall.args[0]).to.deep.equal(
        {
          protocol: "amqps",
          hostname: "tls.broker",
          port: 5671,
          username: "admin",
          password: "",
          vhost: "/secure",
        },
      );
      sinon.assert.calledWithExactly(fakeChannel.prefetch, 5);
    });

    it("should throw error if connection fails", async () => {
      sandbox.stub(console, "error");
      (amqp.connect as sinon.SinonStub).rejects(new Error("Connection error"));

      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await expect(rmq.connect()).to.be.rejectedWith("Connection error");
    });

    it("should close connection and reset state if partial connect setup fails", async () => {
      sandbox.stub(console, "error");
      fakeChannel.prefetch.rejects(new Error("Prefetch failed"));
      fakeConnection.close.rejects(new Error("Close error ignored"));

      const rmq = new RabbitMQ({ name: "test", tasks: new Set(["q1"]) });
      await expect(rmq.connect()).to.be.rejectedWith("Prefetch failed");

      sinon.assert.calledOnce(fakeConnection.close);
      await expect(rmq.consume()).to.be.rejectedWith("Channel not initialized");
    });
  });

  describe("connection & channel error/close events", () => {
    it("should forward connection, channel, and publishChannel errors to onError", async () => {
      const onError = sandbox.stub();
      const rmq = new RabbitMQ({ name: "test", onError });
      await rmq.connect();

      const connErr = new Error("conn boom");
      const chanErr = new Error("chan boom");
      const pubErr = new Error("pub boom");

      fakeConnection.emit("error", connErr);
      fakeChannel.emit("error", chanErr);
      fakeConfirmChannel.emit("error", pubErr);

      sinon.assert.calledThrice(onError);
      sinon.assert.calledWithExactly(onError.firstCall, connErr);
      sinon.assert.calledWithExactly(onError.secondCall, chanErr);
      sinon.assert.calledWithExactly(onError.thirdCall, pubErr);
    });

    it("should notify onError and reset state on unexpected connection close", async () => {
      const onError = sandbox.stub();
      const rmq = new RabbitMQ({ name: "test", onError });
      await rmq.connect();

      fakeConnection.emit("close");

      sinon.assert.calledOnce(onError);
      expect(onError.firstCall.args[0].message).to.include(
        "closed unexpectedly",
      );
      await expect(rmq.consume()).to.be.rejectedWith("Channel not initialized");
    });

    it("should default onError to console.error", async () => {
      const consoleErrorStub = sandbox.stub(console, "error");
      const rmq = new RabbitMQ({ name: "test" });
      await rmq.connect();

      fakeChannel.emit("error", "non-error-value");

      sinon.assert.calledOnce(consoleErrorStub);
      expect(consoleErrorStub.firstCall.args[1]).to.be.an.instanceof(Error);
    });
  });

  describe("subscribeToQueue & consume", () => {
    it("should throw if consume is called without channel initialized", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await expect(rmq.consume()).to.be.rejectedWith("Channel not initialized");
    });

    it("should setup consumer for subscriptions", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      const handler = sandbox.stub();
      await rmq.subscribeToQueue("queue-1", handler);

      await rmq.consume();

      sinon.assert.calledOnce(fakeChannel.consume);
      sinon.assert.calledWith(fakeChannel.consume, "test.queue-1");
    });

    it("should skip queue if already consuming", async () => {
      const consoleLogStub = sandbox.stub(console, "log");
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      const handler = sandbox.stub();
      await rmq.subscribeToQueue("queue-1", handler);
      await rmq.consume();

      await rmq.subscribeToQueue("queue-1", handler);
      await rmq.consume();

      sinon.assert.calledWith(
        consoleLogStub,
        "already consuming queue test.queue-1",
      );
    });

    it("should invoke handler on valid JSON message and ack on done", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      let consumerCallback: Function | null = null;
      fakeChannel.consume.callsFake((queue: string, cb: Function) => {
        consumerCallback = cb;
        return Promise.resolve({ consumerTag: "tag-1" });
      });

      const handler = sandbox.stub().callsFake((job, jobMeta, done) => {
        done();
      });

      await rmq.subscribeToQueue("my-queue", handler);
      await rmq.consume();

      const fakeMsg = {
        content: Buffer.from(JSON.stringify({ foo: "bar" })),
        properties: { correlationId: "123" },
      };

      consumerCallback!(fakeMsg);

      sinon.assert.calledOnce(handler);
      sinon.assert.calledWith(
        handler,
        { foo: "bar" },
        { correlationId: "123" },
      );
      sinon.assert.calledOnce(fakeChannel.ack);
      sinon.assert.calledWith(fakeChannel.ack, fakeMsg);
    });

    it("should ignore null messages in consume wrapper", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      let consumerCallback: Function | null = null;
      fakeChannel.consume.callsFake((queue: string, cb: Function) => {
        consumerCallback = cb;
        return Promise.resolve({ consumerTag: "tag-1" });
      });

      await rmq.subscribeToQueue("my-queue", sandbox.stub());
      await rmq.consume();

      consumerCallback!(null);
      sinon.assert.notCalled(fakeChannel.ack);
    });

    it("should ack and log error when message content is not valid JSON", async () => {
      sandbox.stub(console, "error");
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      let consumerCallback: Function | null = null;
      fakeChannel.consume.callsFake((queue: string, cb: Function) => {
        consumerCallback = cb;
        return Promise.resolve({ consumerTag: "tag-1" });
      });

      await rmq.subscribeToQueue("my-queue", sandbox.stub());
      await rmq.consume();

      const fakeMsg = {
        content: Buffer.from("not-valid-json"),
        properties: {},
      };

      consumerCallback!(fakeMsg);

      sinon.assert.calledOnce(fakeChannel.ack);
      sinon.assert.calledWith(fakeChannel.ack, fakeMsg);
    });
  });

  describe("publishTask, unsubscribe, disconnect, assertQueue", () => {
    it("should throw if publishChannel is not initialized on publishTask", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await expect(rmq.publishTask("q1", { a: 1 })).to.be.rejectedWith(
        "Publish channel not initialized",
      );
    });

    it("should publish payload to queue", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      await rmq.publishTask("q1", { a: 1 });

      sinon.assert.calledOnce(fakeConfirmChannel.sendToQueue);
      sinon.assert.calledWith(
        fakeConfirmChannel.sendToQueue,
        "test.q1",
        Buffer.from(JSON.stringify({ a: 1 })),
      );
    });

    it("should cancel active consumers on unsubscribe", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      await rmq.subscribeToQueue("q1", sandbox.stub());
      await rmq.consume();

      await rmq.unsubscribe();

      sinon.assert.calledOnce(fakeChannel.cancel);
      sinon.assert.calledWith(fakeChannel.cancel, "tag-123");
    });

    it("should return early on disconnect if not initialized", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.disconnect();
      sinon.assert.notCalled(fakeConnection.close);
    });

    it("should wait for confirms, close connection, suppress unexpected-close error, and reset state on disconnect", async () => {
      const onError = sandbox.stub();
      const rmq = new RabbitMQ({ name: "test", tasks: new Set(), onError });
      await rmq.connect();

      fakeConnection.close.callsFake(async () => {
        fakeConnection.emit("close");
      });

      await rmq.disconnect();

      sinon.assert.calledOnce(fakeConfirmChannel.waitForConfirms);
      sinon.assert.calledOnce(fakeConnection.close);
      sinon.assert.notCalled(onError);
      await expect(rmq.consume()).to.be.rejectedWith("Channel not initialized");
      await expect(rmq.publishTask("q1", { a: 1 })).to.be.rejectedWith(
        "Publish channel not initialized",
      );
    });

    it("should still reset state if disconnect throws", async () => {
      const rmq = new RabbitMQ({ name: "test" });
      await rmq.connect();

      fakeConnection.close.rejects(new Error("close failed"));
      await expect(rmq.disconnect()).to.be.rejectedWith("close failed");
      await expect(rmq.consume()).to.be.rejectedWith("Channel not initialized");
    });

    it("should throw error if channel is not initialized on assertQueue", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await expect((rmq as any).assertQueue("q1")).to.be.rejectedWith(
        "Channel not initialized",
      );
    });
  });
});
