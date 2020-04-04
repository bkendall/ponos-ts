import * as Promise from "bluebird";

export interface WorkerData {
  message: string;
}

export type WorkerFunction = (data: WorkerData) => Promise<unknown>;

export class PonosWorker {
  attempt: number;
  job: WorkerData;
  msTimeout: number;
  queue: string;
  task: WorkerFunction;

  constructor(
    attempt: number,
    job: WorkerData,
    queue: string,
    task: WorkerFunction
  ) {
    this.attempt = attempt;
    this.job = job;
    this.queue = queue;
    this.task = task;

    this.msTimeout = 500;
  }

  static create(
    attempt: number,
    job: WorkerData,
    queue: string,
    task: WorkerFunction
  ): PonosWorker {
    return new PonosWorker(attempt, job, queue, task);
  }

  run(): Promise<void> {
    // TODO(bkendall): there's more error handling to be done.
    return Promise.bind(this)
      .then(() => this.wrapTask())
      .then(() => this.handleTaskSuccess())
      .catch((err) => {
        console.error(err);
        throw err;
      })
      .catch((err) => this.retryWithDelay(err));
  }

  // TODO(bkendall): validate a job.

  private wrapTask(): Promise<unknown> {
    let taskPromise = Promise.try(() => {
      return this.task(this.job);
    });

    if (this.msTimeout) {
      taskPromise = taskPromise.timeout(this.msTimeout);
    }

    return taskPromise;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private retryWithDelay(err: object): Promise<void> {
    // TODO(bkendall): actually delay us some amount.
    return Promise.delay(200).then(() => {
      return this.run();
    });
  }

  private handleTaskSuccess(): void {
    // TODO(bkendall): do something more useful here.
    // console.log('success');
  }
}
