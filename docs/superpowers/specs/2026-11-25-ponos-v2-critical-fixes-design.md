# Ponos 2.0 Critical Bug Fixes — Design Spec

**Date:** 2026-11-25  
**Target Version:** `2.0.0` (breaking changes documented with Conventional Commits `!` and `BREAKING CHANGE:` footers)  
**Scope:** Two sequential PRs addressing transport/connection safety (PR 1) and worker execution, retries, and graceful drain (PR 2).

---

## Intent & Why

`ponos-ts` currently has modern packaging and CI scaffolding, but its runtime core (`src/rabbitmq.ts`, `src/server.ts`, `src/worker.ts`) is still in early-prototype state with several production hazards: plaintext credential logging, unencoded AMQP URLs, missing `prefetch` backpressure, uncaught broker disconnect events, non-functional dynamic `setTask()`, concurrent/LIFO queue execution instead of awaited FIFO, an infinite `200ms` retry loop with a hardcoded `500ms` timeout, and ungraceful shutdown.

These two PRs fix the critical runtime and security bugs to make `ponos-ts` predictable and safe in production as a `2.0.0` release while preserving its minimal single-dependency footprint.

## Goals

- Eliminate credential leaks and brittle AMQP URL interpolation; support `amqp`/`amqps`, custom ports, vhosts, and `RABBITMQ_URL` or programmatic `ServerOptions`.
- Enforce broker `prefetch` backpressure, attach connection/channel `'error'` and `'close'` handlers, reset state cleanly on disconnect/unexpected close, and make `server.setTask()` work both before and after `start()`.
- Settle failed or malformed messages with `channel.nack(msg, false, false)` instead of silently `ack`ing or hanging unacknowledged.
- Fix `Server`'s work queue to await jobs in true FIFO order (with configurable concurrency) and drain in-flight workers before closing the connection on `stop()`.
- Replace `PonosWorker`'s infinite `200ms` recursion and hardcoded `500ms` timeout with bounded exponential-backoff retries, configurable timeouts with `AbortSignal`, and `TaskFatalError`.

## Non-Goals (Deferred to Later Work)

- Automatic background RabbitMQ reconnection/channel recovery across broker restarts.
- Pub/sub exchange event handlers (`Server` `events`).
- Generic payload schema validation hooks (`WorkerData` remains `{ message: string }` until the v2 API/typing pass).
- CI/packaging cleanup (`LICENSE`, `cloudbuild.yaml` removal, `package.json` `exports`, ESLint/test-runner modernization).

## Anti-Goals

- Adding runtime dependencies beyond `amqplib`.
- Silently `ack`ing malformed JSON, unregistered-queue messages, or exhausted/fatal job failures.
- Shipping breaking behavioral changes without Conventional Commit `!` / `BREAKING CHANGE:` markers.

## Constraints

- Node.js `>= 22.0.0`
- ESM (`"type": "module"`, TypeScript `"module": "NodeNext"`, `"strict": true`)
- Sole runtime dependency: `amqplib` (`^2.0.1`)
- Conventional Commits with `!` and `BREAKING CHANGE:` footers for every breaking change to support `2.0.0` release-note generation.

---

## Approaches Considered

### Approach 1 (Chosen): Raw `amqplib` with `Options.Connect`, `prefetch`, explicit error/close hooks, and bounded worker loop
- Keep `amqplib` as the sole runtime dependency.
- Pass structured `amqp.Options.Connect` objects (or explicit URLs) to `amqp.connect()`, remove `console.log(url)`, enforce `channel.prefetch`, attach `'error'`/`'close'` listeners forwarding to `onError`, reset state on disconnect/close, settle failures via `nack(false)`, and fix `Server` + `PonosWorker` execution/retry/drain semantics.
- **Trade-off**: Preserves the tiny single-dependency footprint and clean unit-testability, while delegating process restarts after hard broker loss to the caller or container supervisor.

### Approach 2 (Rejected): Adopt `amqp-connection-manager` for automatic broker reconnection
- Replace direct `amqplib` connection management with `amqp-connection-manager` to automatically reconnect, recreate channels, and re-subscribe consumers.
- **Trade-off**: Adds a second runtime dependency, buffers outbound publishes in memory during outages, and requires rewriting the transport test surface—overkill for Ponos's lightweight design.

---

## Architecture & PR Split

### PR 1 — Transport & Connection Safety (`src/rabbitmq.ts`, `src/server.ts`, `src/index.ts`)

1. **Credential Hygiene & Connection Configuration (`RabbitMQ`, `ServerOptions`)**:
   - Remove `console.log(url)` completely.
   - Export `RabbitMQConnectionConfig`:
     `{ url?: string; protocol?: "amqp" | "amqps"; hostname?: string; port?: number; username?: string; password?: string; vhost?: string }`.
   - Export `ServerOptions`:
     `{ name?: string; rabbitmq?: string | RabbitMQConnectionConfig; prefetch?: number; onError?: (err: Error) => void }`.
   - Support `new Server(tasks?, options?)` (defaulting `tasks` to `new Map()`).
   - Resolve connection target in `RabbitMQ`:
     - Explicit `connection` string, `connection.url`, or `process.env.RABBITMQ_URL` takes precedence.
     - Otherwise construct `amqp.Options.Connect` from `connection` options over env vars (`RABBITMQ_PROTOCOL`, `RABBITMQ_HOSTNAME`, `RABBITMQ_PORT`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD`, `RABBITMQ_VHOST`), defaulting `protocol` to `"amqp"`, `port` to `5671` (`amqps`) or `5672` (`amqp`), and `vhost` to `"/"`.
     - Validate `protocol` (`"amqp" | "amqps"`) and `port` (integer `1..65535`), and pass `username`/`password` directly in `Options.Connect` so special characters do not break URL parsing.

2. **Prefetch Backpressure & Lifecycle Events (`RabbitMQ`)**:
   - Default `prefetch` to `1` (validated as positive integer `>= 1`) and call `await this.channel.prefetch(this.prefetch)` during `connect()`.
   - Attach `'error'` listeners on `connection`, `channel`, and `publishChannel` forwarding `Error`s to `onError` (defaulting to `console.error`).
   - Attach `'close'` listener on `connection`; when unexpected (`!closing`), notify `onError` and reset active connection/channel/consumer/asserted-queue state.
   - If `connect()` fails partway through (e.g., `createChannel`, `prefetch`, or `assertQueue` throws), close any opened connection cleanly and reset state before rethrowing.
   - Ensure `disconnect()` always resets state via `setCleanState()` in a `finally` block.

3. **Explicit `ack`/`nack` Settlement & Dynamic `setTask()` (`RabbitMQ`, `Server`)** *(Breaking `2.0` change)*:
   - Export `MessageActions` (`{ ack: () => void; nack: (requeue?: boolean) => void }`) and update `RabbitMessageHandler` to pass `actions` instead of a single `done` callback; guard `actions` so duplicate `ack`/`nack` calls are idempotent no-ops.
   - **Breaking**: Invalid JSON payloads in `RabbitMQ.consume()` invoke `onError` and call `actions.nack(false)` (`channel.nack(msg, false, false)`) instead of `channel.ack(msg)`.
   - **Breaking**: Messages arriving for an unregistered/missing task handler in `Server` invoke `onError` and call `actions.nack(false)` instead of hanging unacknowledged.
   - **Breaking**: When `worker.run()` rejects, `Server` invokes `onError` and calls `actions.nack(false)` instead of `actions.ack()`.
   - Fix `Server.setTask(queueName, task)`: preserve existing `workQueues` entry if present, register `queueName` with `RabbitMQ` (`registerTask`), and have `Server.consume()` subscribe any unsubscribed tasks while `RabbitMQ.consume()` asserts any unasserted queues before consuming.

### PR 2 — FIFO Execution, Bounded Retries & Graceful Drain (`src/worker.ts`, `src/server.ts`, `src/index.ts`)

1. **True FIFO Queue & Graceful `stop()` Drain (`Server`)**:
   - Fix `workLoop()` to `shift()` FIFO (instead of `pop()` LIFO) and `await` worker completion up to `options.concurrency ?? 1` instead of firing all jobs in parallel.
   - Track in-flight worker promises so `stop()` unsubscribes from queues first, awaits all in-flight jobs to settle and `ack`/`nack`, and only then calls `disconnect()`.

2. **Bounded Exponential-Backoff Retries, Configurable Timeouts & `TaskFatalError` (`PonosWorker`, `ServerOptions`)** *(Breaking `2.0` change)*:
   - Export `TaskFatalError` so handlers can fail immediately without retries.
   - Add `ServerOptions` worker settings: `taskTimeoutMs` (default `30_000`, `0` disables timeout), `maxRetries` (default `3`), `initialRetryDelayMs` (default `1_000`), `maxRetryDelayMs` (default `30_000`).
   - Replace `PonosWorker`'s infinite `200ms` recursion and hardcoded `500ms` timeout with an iterative retry loop using exponential backoff capped at `maxRetryDelayMs`, passing optional `{ signal, attempt }` context as the 2nd argument to `WorkerFunction`.
   - Re-throw after exhausting `maxRetries` or catching `TaskFatalError` so `Server` settles the broker message with `nack(false)`.
