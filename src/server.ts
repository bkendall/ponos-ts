import * as Promise from 'bluebird';
import {RabbitMQ} from './rabbitmq';
import {PonosWorker, WorkerData, WorkerFunction} from './worker';

export {WorkerData, WorkerFunction};

export class Server {
  // private events: Map<string, Function>;
  private rabbitmq: RabbitMQ;
  private tasks: Map<string, WorkerFunction>;
  private workQueues: Map<string, Array<() => void>>;

  constructor() {
    this.workQueues = new Map();
    this.tasks = new Map();
    // this.events = new Map();
    this.rabbitmq = new RabbitMQ({
      name: 'ponos',
    });
  }

  consume(): Promise<void> {
    return this.rabbitmq.consume().return();
  }

  start(): Promise<void> {
    return this.rabbitmq.connect()
      .then(() => {
        return this.subscribeAll();
      })
      .then(() => {
        return this.consume();
      })
      .catch((err) => {
        console.error('start error', err);
        throw err;
      });
  }

  stop(): Promise<void> {
    return this.rabbitmq.unsubscribe()
      .then(() => {
        return this.rabbitmq.disconnect();
      })
      .catch((err: Error) => {
        console.error('stop error', err);
        throw err;
      });
  }

  setTask(queueName: string, task: WorkerFunction): this {
    this.workQueues.set(queueName, []);
    this.tasks.set(queueName, task);
    return this;
  }

  private subscribeAll(): Promise<void> {
    return Promise.map(this.tasks.keys(), (queue) => {
      return this.rabbitmq.subscribeToQueue(
        queue,
        (job: WorkerData, jobMeta: object, done: () => void): void => {
          this.enqueue(queue, this.tasks.get(queue), job, jobMeta, done);
        });
    })
      .return();
  }

  private enqueue(
      name: string,
      worker: WorkerFunction,
      job: WorkerData,
      jobMeta: object,
      done: () => void,
  ): void {
    this.workQueues.get(name).push(() => {
      this.runWorker(name, worker, job, jobMeta, done);
    });
    if (this.workQueues.get(name).length == 1) {
      this.workLoop(name);
    }
  }

  private workLoop(name: string) {
    return Promise.try(() => {
      const worker = this.workQueues.get(name).pop();
      if (worker) {
        worker();
        this.workLoop(name);
      }
    });
  }

  private runWorker(
      queueName: string,
      handler: WorkerFunction,
      job: WorkerData,
      jobMeta: object,
      done: () => void,
  ): Promise<void> {
    const worker = PonosWorker.create(0, job, queueName, handler);
    return worker.run()
      .finally(() => { done(); });
  }
}
