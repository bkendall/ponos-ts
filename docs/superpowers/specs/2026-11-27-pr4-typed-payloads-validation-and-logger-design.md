# PR 4: Generic Task Payloads, Validation Hooks & Structured Logger — Design Spec

**Date:** 2026-11-27  
**Scope:** Ergonomic `2.0` TypeScript generics, zero-dependency payload validation hooks, and pluggable structured logging across `Server`, `RabbitMQ`, and `PonosWorker`.

---

## Intent & Why

After hardening transport safety, FIFO execution, bounded retries, and packaging in PRs 1–3, `ponos-ts` still forces every handler to accept `{ message: string }` (`WorkerData`), offers no built-in way to validate/parse incoming payloads before running or retrying a task (`// TODO(bkendall): validate a job.`), and prints lifecycle and error messages directly via `console.log`/`console.error`.

PR 4 rounds out the `2.0.0` ergonomics without adding any runtime dependencies beyond `amqplib`.

## Goals

- Introduce a pluggable `Logger` interface (`info`, `warn`, `error`, optional `debug`) and `defaultLogger`, routing all logging in `RabbitMQ`, `Server`, and retry warnings through `options.logger`.
- Parameterize `WorkerFunction<TData = WorkerData>`, `PonosWorker<TData = WorkerData>`, and `PonosWorkerOptions<TData = WorkerData>` so different queues can declare distinct payload types cleanly.
- Add `TaskDefinition<TData>` and zero-dependency `TaskValidator<TData>` supporting plain functions, Standard Schema v1 (`~standard.validate`, compatible with Zod, Valibot, ArkType), and `{ parse(value) }` schemas.
- Run validation once prior to the worker retry loop and convert validation errors into `TaskFatalError`, ensuring invalid payloads are never retried and immediately settle with `nack(false)`.

## Non-Goals

- Pub/sub exchange event handlers (`Server` `events`) or exporting a standalone task publisher API.
- Bundling third-party schema validation dependencies (`zod`, `valibot`, etc.).

## Anti-Goals

- Adding runtime dependencies beyond `amqplib`.
- Breaking existing `WorkerData`-typed or 1-argument handlers (`async (job: WorkerData) => {}`).

## Constraints

- Node.js `>= 22.0.0`, ESM (`"type": "module"`, `"module": "NodeNext"`), `"strict": true`.
- Sole runtime dependency: `amqplib` (`^2.0.1`).
- `defaultLogger` must delegate dynamically to `console` at call time so existing `sinon.stub(console, ...)` behavior stays intact when no custom `logger` is provided.

## Approaches Considered

### Approach 1 (Chosen): Zero-dependency `TaskValidator` (Function + Standard Schema v1 + `.parse()`) + `TaskDefinition` + `Logger`
- Support plain validator/transform functions, Standard Schema v1 (`~standard.validate`), and `{ parse }` schemas with zero runtime dependencies.
- Accept both `WorkerFunction<T>` and `TaskDefinition<T>` in `Server` / `setTask<T>()`, preserving backwards compatibility while unlocking full per-queue payload typing and per-queue retry/timeout overrides.

### Approach 2 (Rejected): Bundle `zod` or require a custom adapter wrapper
- Bundling `zod` violates Ponos's single-dependency footprint, while requiring custom user wrappers for Standard Schema libraries adds unnecessary boilerplate.
