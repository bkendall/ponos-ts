import sinon from "sinon";
import { expect } from "chai";
import amqp from "amqplib";
import { RabbitMQ } from "../src/rabbitmq.js";

describe("RabbitMQ", () => {
  let sandbox: sinon.SinonSandbox;
  let fakeChannel: any;
  let fakeConfirmChannel: any;
  let fakeConnection: any;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    fakeChannel = {
      assertQueue: sandbox.stub().resolves(),
      consume: sandbox.stub().resolves({ consumerTag: "tag-123" }),
      ack: sandbox.stub(),
      cancel: sandbox.stub().resolves(),
    };

    fakeConfirmChannel = {
      sendToQueue: sandbox.stub(),
      waitForConfirms: sandbox.stub().resolves(),
    };

    fakeConnection = {
      createChannel: sandbox.stub().resolves(fakeChannel),
      createConfirmChannel: sandbox.stub().resolves(fakeConfirmChannel),
      close: sandbox.stub().resolves(),
    };

    sandbox.stub(amqp, "connect").resolves(fakeConnection as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("constructor", () => {
    it("should initialize with default options", () => {
      const rmq = new RabbitMQ({ name: "", tasks: new Set() });
      expect(rmq).to.be.an.instanceof(RabbitMQ);
    });

    it("should use env variables for auth if provided", () => {
      const originalUser = process.env.RABBITMQ_USERNAME;
      const originalPass = process.env.RABBITMQ_PASSWORD;
      process.env.RABBITMQ_USERNAME = "admin";
      process.env.RABBITMQ_PASSWORD = "secret";

      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      expect(rmq).to.be.an.instanceof(RabbitMQ);

      process.env.RABBITMQ_USERNAME = originalUser;
      process.env.RABBITMQ_PASSWORD = originalPass;
    });
  });

  describe("connect", () => {
    it("should connect to RabbitMQ and assert queues for tasks", async () => {
      sandbox.stub(console, "log");
      const rmq = new RabbitMQ({
        name: "test-app",
        tasks: new Set(["task-a", "task-b"]),
      });

      await rmq.connect();

      sinon.assert.calledOnce(amqp.connect as sinon.SinonStub);
      sinon.assert.calledTwice(fakeChannel.assertQueue);
      sinon.assert.calledWith(fakeChannel.assertQueue, "test-app.task-a");
      sinon.assert.calledWith(fakeChannel.assertQueue, "test-app.task-b");
    });

    it("should format URL with auth string when credentials are set", async () => {
      sandbox.stub(console, "log");
      const originalUser = process.env.RABBITMQ_USERNAME;
      const originalPass = process.env.RABBITMQ_PASSWORD;
      process.env.RABBITMQ_USERNAME = "user";
      process.env.RABBITMQ_PASSWORD = "pass";

      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      const connectCallUrl = (amqp.connect as sinon.SinonStub).firstCall.args[0];
      expect(connectCallUrl).to.include("user:pass@");

      process.env.RABBITMQ_USERNAME = originalUser;
      process.env.RABBITMQ_PASSWORD = originalPass;
    });

    it("should throw error if connection fails", async () => {
      sandbox.stub(console, "log");
      sandbox.stub(console, "error");
      (amqp.connect as sinon.SinonStub).rejects(new Error("Connection error"));

      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await expect(rmq.connect()).to.be.rejectedWith("Connection error");
    });
  });

  describe("subscribeToQueue & consume", () => {
    it("should throw if consume is called without channel initialized", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await expect(rmq.consume()).to.be.rejectedWith("Channel not initialized");
    });

    it("should setup consumer for subscriptions", async () => {
      sandbox.stub(console, "log");
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

      sinon.assert.calledWith(consoleLogStub, "already consuming queue test.queue-1");
    });

    it("should invoke handler on valid JSON message and ack on done", async () => {
      sandbox.stub(console, "log");
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
      sinon.assert.calledWith(handler, { foo: "bar" }, { correlationId: "123" });
      sinon.assert.calledOnce(fakeChannel.ack);
      sinon.assert.calledWith(fakeChannel.ack, fakeMsg);
    });

    it("should ignore null messages in consume wrapper", async () => {
      sandbox.stub(console, "log");
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
      sandbox.stub(console, "log");
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
        "Publish channel not initialized"
      );
    });

    it("should publish payload to queue", async () => {
      sandbox.stub(console, "log");
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      await rmq.publishTask("q1", { a: 1 });

      sinon.assert.calledOnce(fakeConfirmChannel.sendToQueue);
      sinon.assert.calledWith(
        fakeConfirmChannel.sendToQueue,
        "test.q1",
        Buffer.from(JSON.stringify({ a: 1 }))
      );
    });

    it("should cancel active consumers on unsubscribe", async () => {
      sandbox.stub(console, "log");
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

    it("should wait for confirms and close connection on disconnect", async () => {
      sandbox.stub(console, "log");
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await rmq.connect();

      await rmq.disconnect();

      sinon.assert.calledOnce(fakeConfirmChannel.waitForConfirms);
      sinon.assert.calledOnce(fakeConnection.close);
    });

    it("should throw error if channel is not initialized on assertQueue", async () => {
      const rmq = new RabbitMQ({ name: "test", tasks: new Set() });
      await expect((rmq as any).assertQueue("q1")).to.be.rejectedWith(
        "Channel not initialized"
      );
    });
  });
});
