# PR 4: Generic Task Payloads, Validation Hooks & Structured Logger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable `Logger` interface across `Server` and `RabbitMQ`, generalize `WorkerFunction<TData>` / `PonosWorker<TData>`, and support per-queue `TaskDefinition<TData>` with zero-dependency payload validation (`TaskValidator<TData>`) failing fast via `TaskFatalError`.

**Architecture:** `src/logger.ts` defines `Logger`, `defaultLogger`, and `resolveLogger()` (used by `Server` and `RabbitMQ`). `src/worker.ts` generalizes `WorkerFunction<TData = WorkerData>` and `PonosWorker<TData = WorkerData>`, running an optional `TaskValidator<TData>` (function, Standard Schema v1 `~standard.validate`, or `{ parse }`) once before the retry loop and wrapping failures as `TaskFatalError`. `src/server.ts` accepts `TaskRegistration<TData>` (`WorkerFunction<TData> | TaskDefinition<TData>`) via `new Server(...)` or `setTask<TData>(...)` and forwards per-queue overrides into `PonosWorker.create(...)`.

**Tech Stack:** TypeScript 6 (`NodeNext` ESM, `strict: true`), Node.js `>= 22`, `amqplib` `^2.0.1`, ESLint 10 + Prettier, Mocha + Chai + Sinon + `c8`.

**Spec:** [docs/superpowers/specs/2026-11-27-pr4-typed-payloads-validation-and-logger-design.md](../specs/2026-11-27-pr4-typed-payloads-validation-and-logger-design.md)

## Global Constraints

- Node.js `>= 22.0.0`, ESM (`"type": "module"`, `"module": "NodeNext"`), `"strict": true`.
- Sole runtime dependency: `amqplib` (`^2.0.1`).
- No stray `console.*` calls in `src/rabbitmq.ts`, `src/server.ts`, or `src/worker.ts`; all logging goes through `Logger`.
- Repo-wide `npm test` (`eslint`, `tsc -p tsconfig.check.json`, `tsc`, `mocha`) must pass cleanly.

## Review Focus

- `defaultLogger` must call `console.log`/`warn`/`error`/`debug` dynamically rather than capturing `console.*` references at module-load time, so runtime `console` stubs still intercept logs.
- Validation failures (thrown exceptions or Standard Schema `{ issues }`) must throw `TaskFatalError` before attempt `0` so invalid jobs are never retried and settle with `nack(false)`.
- `Server` constructor's `ReadonlyMap<string, TaskRegistration<any>>` must remain covariant so `Map<string, WorkerFunction<SpecificPayload>>` and `Map<string, WorkerFunction>` both compile cleanly under `strict: true`.
- Invalid `taskTimeoutMs` / `maxRetries` / delay overrides inside `TaskDefinition` passed to `new Server(...)` or `setTask()` must throw `RangeError` eagerly.

---

### Task 1: Pluggable `Logger` Across `Server` and `RabbitMQ` (`src/logger.ts`, `src/rabbitmq.ts`, `src/server.ts`)

**Files:**
- Create: `src/logger.ts`
- Modify: `src/rabbitmq.ts`, `src/server.ts`
- Test: `test/rabbitmq.ts`, `test/server.ts`

- [ ] **Step 1:** Write failing logger tests in `test/rabbitmq.ts` and `test/server.ts` (custom full `logger`, partial `logger` fallback, retry `warn` logs).
- [ ] **Step 2:** Run `npm run test:mocha` to verify failure.
- [ ] **Step 3:** Create `src/logger.ts` (`Logger`, `defaultLogger`, `resolveLogger`) and wire `logger?: Partial<Logger>` through `RabbitMQ` and `Server` (replacing all `console.*` calls in `src/rabbitmq.ts` and `src/server.ts` with `this.logger`).
- [ ] **Step 4:** Format with Prettier and run `npm test` to confirm pass.
- [ ] **Step 5:** Commit: `feat(logger): add pluggable Logger interface across Server and RabbitMQ`.

---

### Task 2: Generic `WorkerFunction<TData>`, `TaskDefinition<TData>`, and Payload Validation (`src/worker.ts`, `src/server.ts`, `src/index.ts`, `README.md`)

**Files:**
- Modify: `src/worker.ts`, `src/server.ts`, `src/index.ts`, `README.md`
- Test: `test/worker.ts`, `test/server.ts`, `test/index.ts`

- [ ] **Step 1:** Write failing tests in `test/worker.ts`, `test/server.ts`, and `test/index.ts` covering function validators, Standard Schema v1 (`~standard.validate`), `{ parse }` schemas, `TaskFatalError` wrapping on failure with zero retries, heterogeneous typed queues via `setTask<T>()`, per-queue retry/timeout overrides, and new exports.
- [ ] **Step 2:** Run `npm run test:mocha` to verify failure.
- [ ] **Step 3:** Implement generic `WorkerFunction<TData>`, `TaskValidator<TData>`, `PonosWorker<TData>` validation, `TaskDefinition<TData>` / `TaskRegistration<TData>` in `Server`, public exports in `src/index.ts`, and `README.md` docs.
- [ ] **Step 4:** Format repo-wide with Prettier and run `npm run clean && npm test && npm run coverage && npm pack --dry-run --cache /tmp/npm-cache`.
- [ ] **Step 5:** Commit: `feat(api): add generic task payloads and runtime validation hooks`, then push and open PR 4.
