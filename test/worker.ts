import sinon from "sinon";
import { expect } from "chai";
import { PonosWorker } from "../src/worker.js";

describe("PonosWorker", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("create", () => {
    it("should return a PonosWorker", () => {
      const newWorker = PonosWorker.create(
        0,
        { message: "" },
        "someQueue",
        async () => {}
      );

      expect(newWorker).to.be.an.instanceof(PonosWorker);
    });
  });

  describe("run", () => {
    it("should run our given task", async () => {
      const taskHandler = sandbox.stub().resolves();
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler
      );

      await worker.run();
      sinon.assert.calledOnce(taskHandler);
    });

    it("should provide data to our task", async () => {
      const taskHandler = sandbox.stub().resolves();
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler
      );

      await worker.run();
      sinon.assert.calledWithExactly(taskHandler, { message: "foo" });
    });

    it("should succeed when msTimeout is 0", async () => {
      const taskHandler = sandbox.stub().resolves("ok");
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler
      );
      worker.msTimeout = 0;

      await worker.run();
      sinon.assert.calledOnce(taskHandler);
    });

    it("should handle operation timeout", async () => {
      const taskHandler = sandbox.stub().callsFake(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler
      );
      worker.msTimeout = 10;
      sandbox.stub(console, "error");
      const retryStub = sandbox.stub(worker as any, "retryWithDelay").resolves();

      await worker.run();
      sinon.assert.calledOnce(retryStub);
      const errPassed = retryStub.firstCall.args[0] as Error;
      expect(errPassed.message).to.include("Operation timed out after 10ms");
    });

    it("should catch errors and call retryWithDelay", async () => {
      const err = new Error("Task failed");
      const taskHandler = sandbox.stub().rejects(err);
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler
      );
      sandbox.stub(console, "error");
      const retryStub = sandbox.stub(worker as any, "retryWithDelay").resolves();

      await worker.run();
      sinon.assert.calledOnce(retryStub);
      sinon.assert.calledWith(retryStub, err);
    });

    it("should execute delay in retryWithDelay", async () => {
      const clock = sandbox.useFakeTimers();
      const taskHandler = sandbox.stub().resolves();
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler
      );

      const runStub = sandbox.stub(worker, "run").resolves();
      const retryPromise = (worker as any).retryWithDelay(new Error("err"));

      clock.tick(200);
      await retryPromise;

      sinon.assert.calledOnce(runStub);
    });
  });
});


