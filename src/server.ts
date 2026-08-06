import { RabbitMQ } from "./rabbitmq.js";
import { PonosWorker } from "./worker.js";
import type { WorkerData, WorkerFunction } from "./worker.js";

export type { WorkerData, WorkerFunction };

export class Server {
  // private events: Map<string, Function>;
  private rabbitmq: RabbitMQ;
  private tasks: Map<string, WorkerFunction>;
  private workQueues: Map<string, (() => void)[]>;

  constructor(tasks: Map<string, WorkerFunction>) {
    this.workQueues = new Map();
    this.tasks = tasks;
    this.rabbitmq = new RabbitMQ({
      name: "ponos",
      tasks: new Set([...this.tasks.keys()]),
    });

    for (const [queue, fn] of this.tasks) {
      this.setTask(queue, fn);
    }
  }

  async consume(): Promise<void> {
    await this.rabbitmq.consume();
  }

  async start(): Promise<void> {
    try {
      await this.rabbitmq.connect();
      await this.subscribeAll();
      await this.consume();
    } catch (err: unknown) {
      console.error("start error", err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.rabbitmq.unsubscribe();
      await this.rabbitmq.disconnect();
    } catch (err: unknown) {
      console.error("stop error", err);
      throw err;
    }
  }

  setTask(queueName: string, task: WorkerFunction): this {
    this.workQueues.set(queueName, []);
    this.tasks.set(queueName, task);
    return this;
  }

  private async subscribeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.tasks.keys()).map((queue: string) => {
        return this.rabbitmq.subscribeToQueue(
          queue,
          (job: WorkerData, jobMeta: object, done: () => void): void => {
            const task = this.tasks.get(queue);
            if (task) {
              this.enqueue(queue, task, job, jobMeta, done);
            }
          },
        );
      }),
    );
  }

  private enqueue(
    name: string,
    worker: WorkerFunction,
    job: WorkerData,
    jobMeta: object,
    done: () => void,
  ): void {
    let queue = this.workQueues.get(name);
    if (!queue) {
      queue = [];
      this.workQueues.set(name, queue);
    }
    queue.push(() => {
      void this.runWorker(name, worker, job, jobMeta, done);
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
    done: () => void,
  ): Promise<void> {
    const worker = PonosWorker.create(0, job, queueName, handler);
    try {
      await worker.run();
    } finally {
      done();
    }
  }
}
