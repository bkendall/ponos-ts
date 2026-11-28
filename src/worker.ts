export interface WorkerData {
  message: string;
}

export interface WorkerContext {
  attempt: number;
  signal: AbortSignal;
  jobMeta?: Record<string, unknown>;
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export type StandardSchemaResult<TOutput> =
  | { readonly value: TOutput; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaIssue> };

export interface StandardSchemaV1<TOutput = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<TOutput> | Promise<StandardSchemaResult<TOutput>>;
  };
}

export interface ParseableSchema<TOutput> {
  parse(value: unknown): TOutput | Promise<TOutput>;
}

export type TaskValidator<TData> =
  | ((raw: unknown) => TData | Promise<TData>)
  | StandardSchemaV1<TData>
  | ParseableSchema<TData>;

export type WorkerFunction<TData = WorkerData> = (
  data: TData,
  context: WorkerContext,
) => Promise<unknown> | PromiseLike<unknown>;

export interface PonosWorkerOptions<TData = WorkerData> {
  taskTimeoutMs?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  validate?: TaskValidator<TData>;
  jobMeta?: Record<string, unknown>;
  onRetry?: (err: Error, nextAttempt: number, delayMs: number) => void;
}

export class TaskFatalError extends Error {
  override readonly name = "TaskFatalError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const DEFAULT_TASK_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
export const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${label} must be a non-negative finite number, received ${value}`,
    );
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${label} must be a non-negative integer, received ${value}`,
    );
  }
}

export function validateWorkerOptions<TData>(
  options: PonosWorkerOptions<TData>,
): void {
  if (options.taskTimeoutMs !== undefined) {
    assertNonNegativeFinite(options.taskTimeoutMs, "taskTimeoutMs");
  }
  if (options.maxRetries !== undefined) {
    assertNonNegativeInteger(options.maxRetries, "maxRetries");
  }
  if (options.initialRetryDelayMs !== undefined) {
    assertNonNegativeFinite(options.initialRetryDelayMs, "initialRetryDelayMs");
  }
  if (options.maxRetryDelayMs !== undefined) {
    assertNonNegativeFinite(options.maxRetryDelayMs, "maxRetryDelayMs");
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function isStandardSchema<TData>(
  validator: TaskValidator<TData>,
): validator is StandardSchemaV1<TData> {
  return (
    typeof validator === "object" &&
    validator !== null &&
    "~standard" in validator
  );
}

export class PonosWorker<TData = WorkerData> {
  attempt: number;
  job: TData;
  msTimeout: number;
  queue: string;
  task: WorkerFunction<TData>;

  private initialAttempt: number;
  private initialRetryDelayMs: number;
  private jobMeta?: Record<string, unknown>;
  private maxRetries: number;
  private maxRetryDelayMs: number;
  private onRetry?: (err: Error, nextAttempt: number, delayMs: number) => void;
  private rawJob: unknown;
  private validate?: TaskValidator<TData>;

  constructor(
    attempt: number,
    job: TData | unknown,
    queue: string,
    task: WorkerFunction<TData>,
    options: PonosWorkerOptions<TData> = {},
  ) {
    assertNonNegativeInteger(attempt, "attempt");
    validateWorkerOptions(options);

    this.initialAttempt = attempt;
    this.attempt = attempt;
    this.rawJob = job;
    this.job = job as TData;
    this.queue = queue;
    this.task = task;

    this.msTimeout = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialRetryDelayMs =
      options.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS;
    this.maxRetryDelayMs =
      options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.validate = options.validate;
    this.jobMeta = options.jobMeta;
    this.onRetry = options.onRetry;
  }

  static create<TData = WorkerData>(
    attempt: number,
    job: TData | unknown,
    queue: string,
    task: WorkerFunction<TData>,
    options: PonosWorkerOptions<TData> = {},
  ): PonosWorker<TData> {
    return new PonosWorker(attempt, job, queue, task, options);
  }

  async run(): Promise<void> {
    if (this.validate) {
      this.job = await this.validatePayload(this.rawJob, this.validate);
    }

    for (
      let attempt = this.initialAttempt;
      attempt <= this.maxRetries;
      attempt++
    ) {
      this.attempt = attempt;
      try {
        await this.executeAttempt(attempt);
        return;
      } catch (err: unknown) {
        if (err instanceof TaskFatalError) {
          throw err;
        }
        const normalizedErr = toError(err);
        if (attempt >= this.maxRetries) {
          throw normalizedErr;
        }
        const delayMs = Math.min(
          this.initialRetryDelayMs * 2 ** attempt,
          this.maxRetryDelayMs,
        );
        this.onRetry?.(normalizedErr, attempt + 1, delayMs);
        await this.sleep(delayMs);
      }
    }
  }

  private async validatePayload(
    raw: unknown,
    validator: TaskValidator<TData>,
  ): Promise<TData> {
    try {
      if (typeof validator === "function") {
        return await validator(raw);
      }
      if (isStandardSchema(validator)) {
        const result = await validator["~standard"].validate(raw);
        if (result.issues) {
          const summary = result.issues
            .map((issue) => issue.message)
            .join("; ");
          throw new TaskFatalError(
            `Job validation failed on queue "${this.queue}": ${summary}`,
          );
        }
        return result.value;
      }
      return await validator.parse(raw);
    } catch (err: unknown) {
      if (err instanceof TaskFatalError) {
        throw err;
      }
      throw new TaskFatalError(
        `Job validation failed on queue "${this.queue}": ${toError(err).message}`,
        { cause: err },
      );
    }
  }

  private async executeAttempt(attempt: number): Promise<unknown> {
    const controller = new AbortController();
    const context: WorkerContext = {
      attempt,
      signal: controller.signal,
      ...(this.jobMeta !== undefined ? { jobMeta: this.jobMeta } : {}),
    };

    const taskPromise = Promise.resolve().then(() =>
      this.task(this.job, context),
    );

    if (this.msTimeout === 0) {
      return await taskPromise;
    }

    // Prevent late rejections from an aborted handler after timeout from crashing Node.
    void taskPromise.catch(() => {});

    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const timeoutErr = new Error(
          `Operation timed out after ${this.msTimeout}ms`,
        );
        controller.abort(timeoutErr);
        reject(timeoutErr);
      }, this.msTimeout);
    });

    try {
      return await Promise.race([taskPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
