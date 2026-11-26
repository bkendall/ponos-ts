import { RabbitMQ } from "./rabbitmq.js";
import type { MessageActions, RabbitMQConnectionConfig } from "./rabbitmq.js";
import { PonosWorker } from "./worker.js";
import type { WorkerData, WorkerFunction } from "./worker.js";

export type { MessageActions, RabbitMQConnectionConfig };
export type { WorkerData, WorkerFunction };

export interface ServerOptions {
  name?: string;
  rabbitmq?: string | RabbitMQConnectionConfig;
  prefetch?: number;
  onError?: (err: Error) => void;
}

export class Server {
  // private events: Map<string, Function>;
  private onError: (err: Error) => void;
  private rabbitmq: RabbitMQ;
  private subscribedQueues: Set<string> = new Set();
  private tasks: Map<string, WorkerFunction>;
  private workQueues: Map<string, (() => void)[]>;

  constructor(
    tasks: Map<string, WorkerFunction> = new Map(),
    options: ServerOptions = {},
  ) {
    this.workQueues = new Map();
    this.tasks = tasks;
    this.onError =
      options.onError ??
      ((err: Error): void => {
        console.error("Server error", err);
      });
    this.rabbitmq = new RabbitMQ({
      name: options.name ?? "ponos",
      tasks: this.tasks.keys(),
      connection: options.rabbitmq,
      prefetch: options.prefetch,
      onError: this.onError,
    });

    for (const [queue, fn] of this.tasks) {
      this.setTask(queue, fn);
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
      console.error("start error", err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.rabbitmq.unsubscribe();
      this.subscribedQueues.clear();
      await this.rabbitmq.disconnect();
    } catch (err: unknown) {
      console.error("stop error", err);
      throw err;
    }
  }

  setTask(queueName: string, task: WorkerFunction): this {
    if (!this.workQueues.has(queueName)) {
      this.workQueues.set(queueName, []);
    }
    this.tasks.set(queueName, task);
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
          (job: WorkerData, jobMeta: object, actions: MessageActions): void => {
            const task = this.tasks.get(queue);
            if (!task) {
              this.onError(
                new Error(`No task handler registered for queue "${queue}"`),
              );
              actions.nack(false);
              return;
            }
            this.enqueue(queue, task, job, jobMeta, actions);
          },
        );
        this.subscribedQueues.add(queue);
      }),
    );
  }

  private enqueue(
    name: string,
    worker: WorkerFunction,
    job: WorkerData,
    jobMeta: object,
    actions: MessageActions,
  ): void {
    let queue = this.workQueues.get(name);
    if (!queue) {
      queue = [];
      this.workQueues.set(name, queue);
    }
    queue.push(() => {
      void this.runWorker(name, worker, job, jobMeta, actions);
    });
    if (queue.length === 1) {
      void this.workLoop(name);
    }
  }

  private async workLoop(name: string): Promise<void> {
    const queue = this.workQueues.get(name);
    const worker = queue?.pop();
    if (worker) {
      worker();
      await this.workLoop(name);
    }
  }

  private async runWorker(
    queueName: string,
    handler: WorkerFunction,
    job: WorkerData,
    jobMeta: object,
    actions: MessageActions,
  ): Promise<void> {
    const worker = PonosWorker.create(0, job, queueName, handler);
    try {
      await worker.run();
      actions.ack();
    } catch (err: unknown) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
      actions.nack(false);
    }
  }
}
