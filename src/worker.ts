import * as Promise from "bluebird";

export interface WorkerData {
  message: string;
}

export type WorkerFunction = (data: WorkerData) => Promise<any>;

export class PonosWorker {
  attempt: number;
  job: WorkerData;
  msTimeout: number;
  queue: string;
  task: (data: WorkerData) => void;

  constructor(
    attempt: number,
    job: WorkerData,
    queue: string,
    task: (data: WorkerData) => void
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
    task: (data: WorkerData) => void
  ): PonosWorker {
    return new PonosWorker(attempt, job, queue, task);
  }

  run(): Promise<void> {
    // TODO(bkendall): there's more error handling to be done.
    return Promise.bind(this)
      .then(this.wrapTask)
      .then(this.handleTaskSuccess)
      .catch((err) => {
        console.error(err);
        throw err;
      })
      .catch(this.retryWithDelay);
  }

  // TODO(bkendall): validate a job.

  private wrapTask(): Promise<any> {
    let taskPromise = Promise.try(() => {
      return this.task(this.job);
    });

    if (this.msTimeout) {
      taskPromise = taskPromise.timeout(this.msTimeout);
    }

    return taskPromise;
  }

  private retryWithDelay(err: object) {
    // TODO(bkendall): actually delay us some amount.
    return Promise.delay(200).then(() => {
      return this.run();
    });
  }

  private handleTaskSuccess() {
    // TODO(bkendall): do something more useful here.
    // console.log('success');
  }
}
