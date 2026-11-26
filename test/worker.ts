import sinon from "sinon";
import { expect } from "chai";
import { PonosWorker, TaskFatalError } from "../src/worker.js";
import type { WorkerContext } from "../src/worker.js";

describe("PonosWorker", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("create & option validation", () => {
    it("should return a PonosWorker with 2.0 defaults", () => {
      const worker = PonosWorker.create(
        0,
        { message: "" },
        "someQueue",
        async () => {},
      );

      expect(worker).to.be.an.instanceof(PonosWorker);
      expect(worker.msTimeout).to.equal(30_000);
    });

    it("should reject invalid attempt and worker options", () => {
      for (const badAttempt of [-1, 1.5, Number.NaN]) {
        expect(() =>
          PonosWorker.create(badAttempt, { message: "" }, "q", async () => {}),
        ).to.throw(RangeError);
      }

      for (const badTimeout of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
        expect(() =>
          PonosWorker.create(0, { message: "" }, "q", async () => {}, {
            taskTimeoutMs: badTimeout,
          }),
        ).to.throw(RangeError);
      }

      for (const badRetries of [-1, 1.5, Number.POSITIVE_INFINITY]) {
        expect(() =>
          PonosWorker.create(0, { message: "" }, "q", async () => {}, {
            maxRetries: badRetries,
          }),
        ).to.throw(RangeError);
      }

      expect(() =>
        PonosWorker.create(0, { message: "" }, "q", async () => {}, {
          initialRetryDelayMs: -10,
        }),
      ).to.throw(RangeError);

      expect(() =>
        PonosWorker.create(0, { message: "" }, "q", async () => {}, {
          maxRetryDelayMs: Number.NaN,
        }),
      ).to.throw(RangeError);
    });
  });

  describe("run", () => {
    it("should pass data and WorkerContext (attempt, signal, jobMeta) to task", async () => {
      let receivedContext: WorkerContext | undefined;
      const taskHandler = sandbox
        .stub()
        .callsFake(async (_data, context: WorkerContext) => {
          receivedContext = context;
        });
      const jobMeta = { correlationId: "abc-123" };
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler,
        { jobMeta },
      );

      await worker.run();

      sinon.assert.calledOnce(taskHandler);
      expect(taskHandler.firstCall.args[0]).to.deep.equal({ message: "foo" });
      expect(receivedContext).to.exist;
      expect(receivedContext!.attempt).to.equal(0);
      expect(receivedContext!.signal).to.be.an.instanceof(AbortSignal);
      expect(receivedContext!.signal.aborted).to.be.false;
      expect(receivedContext!.jobMeta).to.deep.equal(jobMeta);
    });

    it("should disable timeout when taskTimeoutMs is 0", async () => {
      const clock = sandbox.useFakeTimers();
      const taskHandler = sandbox.stub().callsFake(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 60_000);
          }),
      );
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler,
        { taskTimeoutMs: 0 },
      );

      const runPromise = worker.run();
      await clock.tickAsync(60_000);
      await runPromise;

      sinon.assert.calledOnce(taskHandler);
    });

    it("should abort signal on timeout, avoid unhandled rejections, and retry", async () => {
      const clock = sandbox.useFakeTimers();
      const signals: AbortSignal[] = [];
      let attemptCount = 0;

      const taskHandler = sandbox
        .stub()
        .callsFake((_data, context: WorkerContext) => {
          signals.push(context.signal);
          attemptCount += 1;
          if (attemptCount === 1) {
            return new Promise((_resolve, reject) => {
              setTimeout(() => reject(new Error("late rejection")), 200);
            });
          }
          return Promise.resolve("ok");
        });

      const onRetry = sandbox.stub();
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler,
        {
          taskTimeoutMs: 50,
          maxRetries: 2,
          initialRetryDelayMs: 100,
          onRetry,
        },
      );

      const runPromise = worker.run();
      await clock.tickAsync(50);
      expect(signals[0].aborted).to.be.true;

      await clock.tickAsync(100);
      await runPromise;

      // Flush the late rejection timer from attempt 0 to confirm no unhandled rejection occurs.
      await clock.tickAsync(100);

      sinon.assert.calledTwice(taskHandler);
      sinon.assert.calledOnce(onRetry);
      expect(onRetry.firstCall.args[0].message).to.include(
        "Operation timed out after 50ms",
      );
      expect(onRetry.firstCall.args[1]).to.equal(1);
      expect(onRetry.firstCall.args[2]).to.equal(100);
      expect(signals[1].aborted).to.be.false;
    });

    it("should retry with capped exponential backoff and succeed on later attempt", async () => {
      const clock = sandbox.useFakeTimers();
      const taskHandler = sandbox.stub();
      taskHandler.onCall(0).rejects(new Error("err 0"));
      taskHandler.onCall(1).rejects(new Error("err 1"));
      taskHandler.onCall(2).rejects(new Error("err 2"));
      taskHandler.onCall(3).resolves("done");

      const onRetry = sandbox.stub();
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler,
        {
          maxRetries: 3,
          initialRetryDelayMs: 1000,
          maxRetryDelayMs: 3000,
          onRetry,
        },
      );

      const runPromise = worker.run();
      await Promise.resolve();
      sinon.assert.calledOnce(taskHandler);

      await clock.tickAsync(999);
      sinon.assert.calledOnce(taskHandler);
      await clock.tickAsync(1);
      sinon.assert.calledTwice(taskHandler);

      await clock.tickAsync(2000);
      sinon.assert.calledThrice(taskHandler);

      await clock.tickAsync(3000);
      await runPromise;
      expect(taskHandler.callCount).to.equal(4);

      expect(onRetry.callCount).to.equal(3);
      expect(onRetry.getCall(0).args.slice(1)).to.deep.equal([1, 1000]);
      expect(onRetry.getCall(1).args.slice(1)).to.deep.equal([2, 2000]);
      expect(onRetry.getCall(2).args.slice(1)).to.deep.equal([3, 3000]);
    });

    it("should reject after exhausting maxRetries", async () => {
      const clock = sandbox.useFakeTimers();
      const finalErr = new Error("still broken");
      const taskHandler = sandbox.stub().rejects(finalErr);
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler,
        {
          maxRetries: 2,
          initialRetryDelayMs: 50,
          maxRetryDelayMs: 500,
        },
      );

      const runPromise = worker.run();
      const caughtPromise = runPromise.catch((err: unknown) => err);
      await clock.tickAsync(50);
      await clock.tickAsync(100);

      const err = await caughtPromise;
      expect(err).to.equal(finalErr);
      expect(taskHandler.callCount).to.equal(3);
    });

    it("should run once and reject immediately when maxRetries is 0", async () => {
      const taskHandler = sandbox.stub().callsFake(() => {
        throw "string failure";
      });
      const onRetry = sandbox.stub();
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler,
        { maxRetries: 0, onRetry },
      );

      await expect(worker.run()).to.be.rejectedWith("string failure");
      sinon.assert.calledOnce(taskHandler);
      sinon.assert.notCalled(onRetry);
    });

    it("should bypass retries and reject immediately on TaskFatalError", async () => {
      const fatalErr = new TaskFatalError("invalid payload");
      const taskHandler = sandbox.stub().rejects(fatalErr);
      const onRetry = sandbox.stub();
      const worker = PonosWorker.create(
        0,
        { message: "foo" },
        "someQueue",
        taskHandler,
        { maxRetries: 5, initialRetryDelayMs: 1000, onRetry },
      );

      const err = await worker.run().catch((e: unknown) => e);
      expect(err).to.equal(fatalErr);
      expect((err as Error).name).to.equal("TaskFatalError");
      expect(err).to.be.an.instanceof(TaskFatalError);
      sinon.assert.calledOnce(taskHandler);
      sinon.assert.notCalled(onRetry);
    });
  });
});
