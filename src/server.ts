import { resolveLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import { RabbitMQ } from "./rabbitmq.js";
import type { MessageActions, RabbitMQConnectionConfig } from "./rabbitmq.js";
import {
  PonosWorker,
  TaskFatalError,
  validateWorkerOptions,
} from "./worker.js";
import type {
  ParseableSchema,
  PonosWorkerOptions,
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
  TaskValidator,
  WorkerContext,
  WorkerData,
  WorkerFunction,
} from "./worker.js";

export { TaskFatalError };
export type { Logger };
export type { MessageActions, RabbitMQConnectionConfig };
export type {
  ParseableSchema,
  PonosWorkerOptions,
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
  TaskValidator,
  WorkerContext,
  WorkerData,
  WorkerFunction,
};

export interface TaskDefinition<TData = WorkerData> {
  task: WorkerFunction<TData>;
  validate?: TaskValidator<TData>;
  taskTimeoutMs?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export type TaskRegistration<TData = WorkerData> =
  WorkerFunction<TData> | TaskDefinition<TData>;

export interface ServerOptions {
  name?: string;
  rabbitmq?: string | RabbitMQConnectionConfig;
  prefetch?: number;
  concurrency?: number;
  taskTimeoutMs?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  onError?: (err: Error) => void;
  logger?: Partial<Logger>;
}

interface QueuedJob {
  definition: TaskDefinition<any>;
  job: unknown;
  jobMeta: object;
  actions: MessageActions;
}

function normalizeTaskDefinition<TData>(
  registration: TaskRegistration<TData>,
): TaskDefinition<TData> {
  if (typeof registration === "function") {
    return { task: registration };
  }
  return registration;
}

export class Server {
  // private events: Map<string, Function>;
  private activeCounts: Map<string, number> = new Map();
  private concurrency: number;
  private inFlight: Set<Promise<void>> = new Set();
  private logger: Logger;
  private onError: (err: Error) => void;
  private rabbitmq: RabbitMQ;
  private stopping = false;
  private subscribedQueues: Set<string> = new Set();
  private tasks: Map<string, TaskRegistration<any>>;
  private workQueues: Map<string, QueuedJob[]>;
  private workerOptions: PonosWorkerOptions<any>;

  constructor(
    tasks: ReadonlyMap<string, TaskRegistration<any>> = new Map(),
    options: ServerOptions = {},
  ) {
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError(
        `concurrency must be a positive integer, received ${concurrency}`,
      );
    }
    this.concurrency = concurrency;

    this.workerOptions = {
      ...(options.taskTimeoutMs !== undefined
        ? { taskTimeoutMs: options.taskTimeoutMs }
        : {}),
      ...(options.maxRetries !== undefined
        ? { maxRetries: options.maxRetries }
        : {}),
      ...(options.initialRetryDelayMs !== undefined
        ? { initialRetryDelayMs: options.initialRetryDelayMs }
        : {}),
      ...(options.maxRetryDelayMs !== undefined
        ? { maxRetryDelayMs: options.maxRetryDelayMs }
        : {}),
    };
    validateWorkerOptions(this.workerOptions);

    this.workQueues = new Map();
    this.tasks = new Map();
    this.logger = resolveLogger(options.logger);
    this.onError =
      options.onError ??
      ((err: Error): void => {
        this.logger.error("Server error", err);
      });
    this.rabbitmq = new RabbitMQ({
      name: options.name ?? "ponos",
      tasks: tasks.keys(),
      connection: options.rabbitmq,
      prefetch: options.prefetch ?? this.concurrency,
      onError: this.onError,
      logger: this.logger,
    });

    for (const [queue, registration] of tasks) {
      this.setTask(queue, registration);
    }
  }

  async consume(): Promise<void> {
    await this.subscribeAll();
    await this.rabbitmq.consume();
  }

  async start(): Promise<void> {
    try {
      await this.rabbitmq.connect();
      await this.consume();
    } catch (err: unknown) {
      this.logger.error("start error", err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    try {
      await this.rabbitmq.unsubscribe();
      this.subscribedQueues.clear();

      for (const queue of this.workQueues.values()) {
        while (queue.length > 0) {
          const pending = queue.shift()!;
          pending.actions.nack(true);
        }
      }

      if (this.inFlight.size > 0) {
        await Promise.allSettled(Array.from(this.inFlight));
      }

      await this.rabbitmq.disconnect();
    } catch (err: unknown) {
      this.logger.error("stop error", err);
      throw err;
    } finally {
      this.stopping = false;
    }
  }

  setTask<TData = WorkerData>(
    queueName: string,
    registration: TaskRegistration<TData>,
  ): this {
    if (typeof registration !== "function") {
      validateWorkerOptions(registration);
    }
    if (!this.workQueues.has(queueName)) {
      this.workQueues.set(queueName, []);
    }
    this.tasks.set(queueName, registration);
    this.rabbitmq.registerTask(queueName);
    return this;
  }

  private async subscribeAll(): Promise<void> {
    const pendingQueues = Array.from(this.tasks.keys()).filter(
      (queue: string) => !this.subscribedQueues.has(queue),
    );
    await Promise.all(
      pendingQueues.map(async (queue: string) => {
        await this.rabbitmq.subscribeToQueue(
          queue,
          (job: unknown, jobMeta: object, actions: MessageActions): void => {
            const registration = this.tasks.get(queue);
            if (!registration) {
              this.onError(
                new Error(`No task handler registered for queue "${queue}"`),
              );
              actions.nack(false);
              return;
            }
            this.enqueue(
              queue,
              normalizeTaskDefinition(registration),
              job,
              jobMeta,
              actions,
            );
          },
        );
        this.subscribedQueues.add(queue);
      }),
    );
  }

  private enqueue(
    name: string,
    registrationOrDef: TaskRegistration<any>,
    job: unknown,
    jobMeta: object,
    actions: MessageActions,
  ): void {
    if (this.stopping) {
      actions.nack(true);
      return;
    }

    let queue = this.workQueues.get(name);
    if (!queue) {
      queue = [];
      this.workQueues.set(name, queue);
    }
    queue.push({
      definition: normalizeTaskDefinition(registrationOrDef),
      job,
      jobMeta,
      actions,
    });
    this.pumpQueue(name);
  }

  private pumpQueue(name: string): void {
    const queue = this.workQueues.get(name);
    if (!queue) {
      return;
    }

    while (
      !this.stopping &&
      (this.activeCounts.get(name) ?? 0) < this.concurrency &&
      queue.length > 0
    ) {
      const next = queue.shift()!;
      this.activeCounts.set(name, (this.activeCounts.get(name) ?? 0) + 1);

      const runPromise = this.runWorker(
        name,
        next.definition,
        next.job,
        next.jobMeta,
        next.actions,
      ).finally(() => {
        const remaining = (this.activeCounts.get(name) ?? 1) - 1;
        if (remaining <= 0) {
          this.activeCounts.delete(name);
        } else {
          this.activeCounts.set(name, remaining);
        }
        this.inFlight.delete(runPromise);
        this.pumpQueue(name);
      });

      this.inFlight.add(runPromise);
    }
  }

  private async runWorker(
    queueName: string,
    definition: TaskDefinition<any>,
    job: unknown,
    jobMeta: object,
    actions: MessageActions,
  ): Promise<void> {
    const worker = PonosWorker.create(0, job, queueName, definition.task, {
      ...this.workerOptions,
      ...(definition.taskTimeoutMs !== undefined
        ? { taskTimeoutMs: definition.taskTimeoutMs }
        : {}),
      ...(definition.maxRetries !== undefined
        ? { maxRetries: definition.maxRetries }
        : {}),
      ...(definition.initialRetryDelayMs !== undefined
        ? { initialRetryDelayMs: definition.initialRetryDelayMs }
        : {}),
      ...(definition.maxRetryDelayMs !== undefined
        ? { maxRetryDelayMs: definition.maxRetryDelayMs }
        : {}),
      ...(definition.validate !== undefined
        ? { validate: definition.validate }
        : {}),
      jobMeta: jobMeta as Record<string, unknown>,
      onRetry: (err: Error, nextAttempt: number, delayMs: number): void => {
        this.logger.warn(
          `Retrying task on queue "${queueName}" (attempt ${nextAttempt}) in ${delayMs}ms`,
          err,
        );
      },
    });
    try {
      await worker.run();
      actions.ack();
    } catch (err: unknown) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
      actions.nack(false);
    }
  }
}
