# PR 1: Transport & Connection Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate RabbitMQ credential logging and URL-encoding bugs, enforce `prefetch` backpressure, handle connection/channel errors and clean disconnects, fix dynamic `setTask()`, and settle malformed/unhandled/failed messages via `nack(false)` for Ponos `2.0.0`.

**Architecture:** `RabbitMQ` resolves either an explicit AMQP URL or a structured `amqp.Options.Connect` object (supporting `amqp`/`amqps`, custom ports, vhosts, and special-character credentials), applies `channel.prefetch`, attaches `'error'`/`'close'` listeners, and passes an idempotent `MessageActions` (`ack`/`nack`) handle to `Server`. `Server` accepts `ServerOptions`, delegates task/queue registration cleanly on `setTask()`, and ensures every delivered message settles via `ack()` or `nack(false)`.

**Tech Stack:** TypeScript 6 (`NodeNext` ESM, `strict: true`), Node.js `>= 22`, `amqplib` `^2.0.1`, ESLint 10 + Prettier, Mocha + Chai + Sinon + `c8`.

**Spec:** [docs/superpowers/specs/2026-11-25-ponos-v2-critical-fixes-design.md](../specs/2026-11-25-ponos-v2-critical-fixes-design.md)

## Global Constraints

- Node.js `>= 22.0.0`, ESM (`"type": "module"`, `"module": "NodeNext"`), `"strict": true`.
- Sole runtime dependency: `amqplib` (`^2.0.1`).
- Never log AMQP URLs or credentials.
- Conventional Commits with `!` / `BREAKING CHANGE:` footers for breaking `2.0.0` changes.
- Prettier formatting enforced via `eslint src` (`"prettier/prettier": "error"`).

## Review Focus

- Passwords containing `@`, `:`, `/`, `#`, or `%` passed via env vars or `ServerOptions` must not corrupt connection options.
- `RABBITMQ_PORT` or `options.prefetch` set to `0`, negative, float, or non-numeric values must throw synchronously rather than silently misconfiguring the broker connection.
- Partial failure during `connect()` (e.g., `createChannel`, `prefetch`, or `assertQueue` rejects) must close the opened connection and reset state rather than leaking an open socket.
- Duplicate `actions.ack()` / `actions.nack()` calls on the same message must be idempotent no-ops so `amqplib` never closes the channel for double-acking.
- `server.setTask()` called after `server.start()` + `server.consume()`, as well as `stop()` followed by `start()`, must assert and consume queues cleanly without duplicate consumers.

---

### Task 1: Harden `RabbitMQ` Connection Config, `prefetch`, Error/Close Listeners & Clean Disconnect

**Files:**
- Modify: `src/rabbitmq.ts:1-143`
- Test: `test/rabbitmq.ts:1-275`

**Interfaces:**
- Produces:
  - `export interface RabbitMQConnectionConfig` (`url?`, `protocol?`, `hostname?`, `port?`, `username?`, `password?`, `vhost?`)
  - `export interface RabbitMQOpts` (`name?`, `tasks?`, `connection?`, `prefetch?`, `onError?`)
  - `RabbitMQ.connect(): Promise<void>` (no credential logging, `Options.Connect` or URL, `prefetch`, error/close listeners, partial-connect cleanup)
  - `RabbitMQ.disconnect(): Promise<void>` (graceful `closing` guard + `finally { setCleanState(); }`)

- [ ] **Step 1: Write failing tests in `test/rabbitmq.ts`**
  - Update `beforeEach` stubs so `fakeChannel`, `fakeConfirmChannel`, and `fakeConnection` inherit `EventEmitter` and include `prefetch` and `nack` stubs.
  - Add tests covering: no `console.log` during `connect()`, `RABBITMQ_URL` and explicit `connection` string/object support, `amqps` default port `5671`, special characters (`@:/%#`) in password, invalid `protocol`/`port`/`prefetch` throwing, `channel.prefetch(1)` and custom `prefetch`, `'error'` / unexpected `'close'` events invoking `onError` and resetting state, partial-connect failure closing the connection, and `disconnect()` cleaning up state.
- [ ] **Step 2: Run tests to confirm failure**
  - Run: `npm run test:mocha`
  - Expected: FAIL on new connection config, `prefetch`, and event-handling assertions.
- [ ] **Step 3: Implement hardened connection config, `prefetch`, error/close lifecycle, and clean disconnect in `src/rabbitmq.ts`**
- [ ] **Step 4: Format and verify tests pass**
  - Run: `./node_modules/.bin/prettier --write src/ && npm test`
  - Expected: PASS (lint, `tsc`, and mocha).
- [ ] **Step 5: Commit**
  - `git add src/rabbitmq.ts test/rabbitmq.ts`
  - `git commit -m "fix(rabbitmq): replace unsafe URL logging with structured connect options and prefetch"`

---

### Task 2: Explicit `ack`/`nack` Settlement, Poison-Message `nack`, Dynamic `setTask()` & `ServerOptions`

**Files:**
- Modify: `src/rabbitmq.ts`
- Modify: `src/server.ts:1-116`
- Modify: `src/index.ts:1-2`
- Modify: `README.md:1-166`
- Test: `test/rabbitmq.ts`, `test/server.ts:1-156`, `test/index.ts:1-8`

**Interfaces:**
- Consumes: `RabbitMQ`, `RabbitMQOpts`, `RabbitMQConnectionConfig` from Task 1.
- Produces:
  - `export interface MessageActions { ack: () => void; nack: (requeue?: boolean) => void; }`
  - `export type RabbitMessageHandler = (job: any, jobMeta: Partial<amqp.MessageProperties>, actions: MessageActions) => void`
  - `RabbitMQ.registerTask(queue: string): void`
  - `export interface ServerOptions { name?: string; rabbitmq?: string | RabbitMQConnectionConfig; prefetch?: number; onError?: (err: Error) => void; }`
  - Re-exported from `src/index.ts`: `Server`, `WorkerData`, `WorkerFunction`, `ServerOptions`, `RabbitMQConnectionConfig`, `MessageActions`.

- [ ] **Step 1: Write failing tests in `test/rabbitmq.ts`, `test/server.ts`, and `test/index.ts`**
  - Update existing `RabbitMQ` and `Server` message-callback tests to expect `actions: MessageActions` (`ack`/`nack`).
  - Add tests for: idempotent `ack()`/`nack()`, invalid JSON calling `nack(msg, false, false)` + `onError`, missing task calling `actions.nack(false)` + `onError`, rejected `worker.run()` calling `actions.nack(false)` + `onError`, `server.setTask()` before `start()` and after `start()` + `consume()`, `ServerOptions` passthrough, and `stop()` -> `start()` restart.
- [ ] **Step 2: Run tests to confirm failure**
  - Run: `npm run test:mocha`
  - Expected: FAIL on `MessageActions`, `nack`, `ServerOptions`, and dynamic `setTask()` assertions.
- [ ] **Step 3: Implement `MessageActions`, `registerTask()`, `consume()` queue assertion, `ServerOptions`, dynamic `setTask()`, `nack` settlement, exports in `src/index.ts`, and `README.md` updates**
- [ ] **Step 4: Format and verify lint, build, tests, and coverage**
  - Run: `./node_modules/.bin/prettier --write src/ && npm test && npm run coverage`
  - Expected: PASS with 0 lint/build errors and all unit tests passing.
- [ ] **Step 5: Commit with breaking-change Conventional Commit**
  - `git add src/rabbitmq.ts src/server.ts src/index.ts test/rabbitmq.ts test/server.ts test/index.ts README.md`
  - `git commit -m "fix!(server,rabbitmq): nack malformed or unhandled messages and fix setTask" -m "BREAKING CHANGE: ..."`
