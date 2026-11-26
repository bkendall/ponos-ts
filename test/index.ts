import { expect } from "chai";
import { Server, TaskFatalError } from "../src/index.js";
import type {
  MessageActions,
  RabbitMQConnectionConfig,
  ServerOptions,
  WorkerContext,
  WorkerData,
  WorkerFunction,
} from "../src/index.js";

describe("index", () => {
  it("should export Server, TaskFatalError, and public types", () => {
    const options: ServerOptions = {
      name: "test",
      prefetch: 2,
      concurrency: 2,
      taskTimeoutMs: 1000,
      maxRetries: 1,
      rabbitmq: { hostname: "localhost" } satisfies RabbitMQConnectionConfig,
    };
    const fn: WorkerFunction = async (
      _data: WorkerData,
      _ctx: WorkerContext,
    ) => {};
    const actionsCheck: MessageActions | undefined = undefined;
    expect(Server).to.be.a("function");
    expect(TaskFatalError).to.be.a("function");
    expect(new TaskFatalError("fatal")).to.be.an.instanceof(Error);
    expect(options.prefetch).to.equal(2);
    expect(fn).to.be.a("function");
    expect(actionsCheck).to.be.undefined;
  });
});
