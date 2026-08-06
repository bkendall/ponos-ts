export interface WorkerData {
  message: string;
}

export type WorkerFunction = (
  data: WorkerData,
) => Promise<unknown> | PromiseLike<unknown>;

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
    task: WorkerFunction,
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
    task: WorkerFunction,
  ): PonosWorker {
    return new PonosWorker(attempt, job, queue, task);
  }

  async run(): Promise<void> {
    // TODO(bkendall): there's more error handling to be done.
    try {
      await this.wrapTask();
      this.handleTaskSuccess();
    } catch (err: unknown) {
      console.error(err);
      await this.retryWithDelay(err);
    }
  }

  // TODO(bkendall): validate a job.

  private async wrapTask(): Promise<unknown> {
    const taskPromise = Promise.resolve().then(() => this.task(this.job));

    if (!this.msTimeout) {
      return await taskPromise;
    }

    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${this.msTimeout}ms`));
      }, this.msTimeout);
    });

    try {
      return await Promise.race([taskPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async retryWithDelay(err: unknown): Promise<void> {
    // TODO(bkendall): actually delay us some amount.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return this.run();
  }

  private handleTaskSuccess(): void {
    // TODO(bkendall): do something more useful here.
    // console.log('success');
  }
}
