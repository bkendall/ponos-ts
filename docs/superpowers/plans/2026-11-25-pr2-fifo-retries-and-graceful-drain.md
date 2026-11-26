# PR 2: FIFO Execution, Bounded Retries, `TaskFatalError` & Graceful Drain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `Server`'s concurrent/LIFO work loop into true awaited FIFO execution with configurable concurrency and graceful `stop()` draining, and replace `PonosWorker`'s infinite `200ms` retry recursion and hardcoded `500ms` timeout with bounded exponential-backoff retries, configurable timeouts with `AbortSignal`, and `TaskFatalError`.

**Architecture:** `PonosWorker` runs an iterative attempt loop (`0..maxRetries`) using a per-attempt `AbortController` raced against a configurable timeout (attaching a `.catch` noop to prevent late unhandled rejections after timeout) and sleeps with capped exponential backoff (`initialRetryDelayMs * 2 ** attempt`), short-circuiting immediately on `TaskFatalError`. `Server` stores `QueuedJob` items in FIFO queues (`shift()`), pumps up to `concurrency` workers per queue using `inFlight` promise tracking, and on `stop()` unsubscribes, requeues (`nack(true)`) unstarted buffered jobs, awaits all in-flight jobs so they can `ack`/`nack(false)`, and then disconnects.

**Tech Stack:** TypeScript 6 (`NodeNext` ESM, `strict: true`), Node.js `>= 22`, `amqplib` `^2.0.1`, ESLint 10 + Prettier, Mocha + Chai + Sinon + `c8`.

**Spec:** [docs/superpowers/specs/2026-11-25-ponos-v2-critical-fixes-design.md](../specs/2026-11-25-ponos-v2-critical-fixes-design.md)

## Global Constraints

- Node.js `>= 22.0.0`, ESM (`"type": "module"`, `"module": "NodeNext"`), `"strict": true`.
- Sole runtime dependency: `amqplib` (`^2.0.1`).
- Conventional Commits with `!` / `BREAKING CHANGE:` footers for breaking `2.0.0` changes.
- Prettier formatting enforced via `eslint src` (`"prettier/prettier": "error"`).

## Review Focus

- An aborted task that rejects asynchronously after its attempt timed out must never trigger an `UnhandledPromiseRejection` in Node.js.
- `TaskFatalError` thrown synchronously or asynchronously must bypass all retry delays and fail on attempt `0`, resulting in `nack(false)`.
- `maxRetries: 0` must execute exactly once with zero sleeps; `taskTimeoutMs: 0` must disable the timeout timer.
- `Server` with `concurrency = 1` must never start job #2 until job #1 finishes, and must execute strictly in FIFO order even when job #1 takes longer than job #2.
- `Server.stop()` called mid-execution must unsubscribe, `nack(true)` any unstarted buffered messages, wait for all in-flight workers to settle and `ack`/`nack(false)` before calling `disconnect()`, and `nack(true)` any messages delivered while stopping.

---

### Task 1: Bounded Exponential-Backoff Retries, `AbortSignal` Timeout & `TaskFatalError` (`src/worker.ts`)

**Files:**
- Modify: `src/worker.ts:1-84`
- Test: `test/worker.ts:1-128`

**Interfaces:**
- Produces:
  - `export class TaskFatalError extends Error`
  - `export interface WorkerContext { attempt: number; signal: AbortSignal; jobMeta?: Record<string, unknown>; }`
  - `export type WorkerFunction = (data: WorkerData, context: WorkerContext) => Promise<unknown> | PromiseLike<unknown>`
  - `export interface PonosWorkerOptions { taskTimeoutMs?: number; maxRetries?: number; initialRetryDelayMs?: number; maxRetryDelayMs?: number; jobMeta?: Record<string, unknown>; onRetry?: (err: Error, nextAttempt: number, delayMs: number) => void; }`
  - `export function validateWorkerOptions(options: PonosWorkerOptions): void`
  - `PonosWorker.create(attempt: number, job: WorkerData, queue: string, task: WorkerFunction, options?: PonosWorkerOptions): PonosWorker`

- [ ] **Step 1: Write failing tests in `test/worker.ts`**
  - Cover option validation (`RangeError`), `(job, context)` signature (`attempt`, `signal`, `jobMeta`), `taskTimeoutMs: 0`, timeout aborting `signal` + suppressing late rejection + retrying, exponential backoff (`1000ms -> 2000ms -> 4000ms` capped by `maxRetryDelayMs`), exhausting `maxRetries`, `maxRetries: 0`, and `TaskFatalError` bypassing retries.
- [ ] **Step 2: Run tests to verify failure**
  - Run: `npm run test:mocha`
  - Expected: FAIL on new `TaskFatalError`, `WorkerContext`, backoff, and retry-cap assertions.
- [ ] **Step 3: Implement `TaskFatalError`, `WorkerContext`, `PonosWorkerOptions`, `validateWorkerOptions`, and iterative retry/timeout execution in `src/worker.ts`**
- [ ] **Step 4: Format and verify tests pass**
  - Run: `./node_modules/.bin/prettier --write src/ && npm test`
  - Expected: PASS (lint, `tsc`, and mocha).
- [ ] **Step 5: Commit**
  - `git add src/worker.ts test/worker.ts`
  - `git commit -m "feat!(worker): add bounded exponential-backoff retries, AbortSignal timeout, and TaskFatalError"` with `BREAKING CHANGE:` footer.

---

### Task 2: True Awaited FIFO Queue Concurrency & Graceful `stop()` Drain (`src/server.ts`, `src/index.ts`, `README.md`)

**Files:**
- Modify: `src/server.ts:1-153`
- Modify: `src/index.ts:1-7`
- Modify: `README.md`
- Test: `test/server.ts`, `test/index.ts`

**Interfaces:**
- Consumes: `PonosWorker`, `PonosWorkerOptions`, `TaskFatalError`, `WorkerContext`, `validateWorkerOptions` from Task 1.
- Produces:
  - Expanded `ServerOptions` (`concurrency?`, `taskTimeoutMs?`, `maxRetries?`, `initialRetryDelayMs?`, `maxRetryDelayMs?`)
  - Re-exported `TaskFatalError` and `WorkerContext` from `src/server.ts` and `src/index.ts`.

- [ ] **Step 1: Write failing tests in `test/server.ts` and `test/index.ts`**
  - Cover invalid `concurrency` / worker options throwing `RangeError`, strict awaited FIFO sequential execution (`concurrency = 1`), bounded `concurrency > 1` with `prefetch` defaulting to `concurrency`, graceful `stop()` draining in-flight jobs while requeuing unstarted buffered jobs (`nack(true)`), `nack(true)` when messages arrive during `stop()`, end-to-end retry exhaustion / `TaskFatalError` calling `nack(false)`, and `TaskFatalError`/`WorkerContext` exports in `test/index.ts`.
- [ ] **Step 2: Run tests to verify failure**
  - Run: `npm run test:mocha`
  - Expected: FAIL on FIFO ordering, concurrency limits, `stop()` drain, and `TaskFatalError` export.
- [ ] **Step 3: Implement `QueuedJob` FIFO `pumpQueue`, `inFlight` tracking, `stop()` drain, `ServerOptions` validation/passthrough, `src/index.ts` exports, and `README.md` updates**
- [ ] **Step 4: Format and verify lint, build, tests, and coverage**
  - Run: `./node_modules/.bin/prettier --write src/ && npm test && npm run coverage`
  - Expected: PASS with 0 lint/build errors and >= 95% statement coverage across `src/`.
- [ ] **Step 5: Commit**
  - `git add src/server.ts src/index.ts test/server.ts test/index.ts README.md`
  - `git commit -m "fix(server): enforce awaited FIFO queue concurrency and drain in-flight jobs on stop"`
