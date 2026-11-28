import { expect } from "chai";
import { Server, TaskFatalError, defaultLogger } from "../src/index.js";
import type {
  Logger,
  MessageActions,
  ParseableSchema,
  PonosWorkerOptions,
  RabbitMQConnectionConfig,
  ServerOptions,
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
  TaskDefinition,
  TaskRegistration,
  TaskValidator,
  WorkerContext,
  WorkerData,
  WorkerFunction,
} from "../src/index.js";

describe("index", () => {
  it("should export Server, TaskFatalError, defaultLogger, and public types", () => {
    const logger: Logger = defaultLogger;
    const options: ServerOptions = {
      name: "test",
      prefetch: 2,
      concurrency: 2,
      taskTimeoutMs: 1000,
      maxRetries: 1,
      logger,
      rabbitmq: { hostname: "localhost" } satisfies RabbitMQConnectionConfig,
    };
    const fn: WorkerFunction = async (
      _data: WorkerData,
      _ctx: WorkerContext,
    ) => {};
    const typedFn: WorkerFunction<{ id: number }> = async (data) => {
      expect(data.id).to.be.a("number");
    };
    const validator: TaskValidator<{ id: number }> = (raw) =>
      raw as { id: number };
    const def: TaskDefinition<{ id: number }> = {
      task: typedFn,
      validate: validator,
    };
    const reg: TaskRegistration<{ id: number }> = def;
    const workerOpts: PonosWorkerOptions<{ id: number }> = {
      validate: validator,
    };
    const actionsCheck: MessageActions | undefined = undefined;
    const parseableCheck: ParseableSchema<number> | undefined = undefined;
    const stdIssueCheck: StandardSchemaIssue | undefined = undefined;
    const stdResultCheck: StandardSchemaResult<number> | undefined = undefined;
    const stdSchemaCheck: StandardSchemaV1<number> | undefined = undefined;

    expect(Server).to.be.a("function");
    expect(TaskFatalError).to.be.a("function");
    expect(defaultLogger.info).to.be.a("function");
    expect(new TaskFatalError("fatal")).to.be.an.instanceof(Error);
    expect(options.prefetch).to.equal(2);
    expect(fn).to.be.a("function");
    expect(reg).to.equal(def);
    expect(workerOpts.validate).to.equal(validator);
    expect(actionsCheck).to.be.undefined;
    expect(parseableCheck).to.be.undefined;
    expect(stdIssueCheck).to.be.undefined;
    expect(stdResultCheck).to.be.undefined;
    expect(stdSchemaCheck).to.be.undefined;
  });
});
