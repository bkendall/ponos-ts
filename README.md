# Ponos

> An opinionated, lightweight task server for Node.js & TypeScript, powered by RabbitMQ.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)

**Ponos** simplifies background task processing by providing a structured, type-safe worker server that consumes jobs from RabbitMQ queues with automated connection handling, message routing, and task execution.

---

## Features

- **Typed Task Handlers**: Full TypeScript support with clean types (`WorkerFunction`, `WorkerData`).
- **Awaited FIFO Queue Processing**: Jobs run sequentially in FIFO order by default (or up to configured per-queue `concurrency`) with matching RabbitMQ `prefetch`.
- **Automated Acking & Dead-Letter Nacking**: Handlers automatically acknowledge completed messages and `nack(false)` malformed JSON, exhausted retries, or `TaskFatalError` failures so dead-letter exchanges can capture them.
- **Bounded Timeout & Exponential Retries**: Configurable task timeout with `AbortSignal` (default `30_000ms`), capped exponential backoff (`maxRetries: 3`), and `TaskFatalError` for non-retryable failures.
- **Graceful Shutdown**: Unsubscribes consumers, requeues unstarted buffered jobs, awaits in-flight workers so they can settle cleanly, and closes the RabbitMQ connection.
- **Flexible Configuration**: Programmatic `ServerOptions` (URL or structured `amqp`/`amqps` connection config, `prefetch`, `onError`) and environment-based RabbitMQ setup (`RABBITMQ_URL`, `RABBITMQ_PROTOCOL`, `RABBITMQ_HOSTNAME`, `RABBITMQ_PORT`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD`, `RABBITMQ_VHOST`).

---

## Installation

```bash
npm install ponos-ts
```

*Requires Node.js >= 22.0.0*

---

## Quick Start

### 1. Define and Start a Worker Server

Create a server instance, register queue task handlers, and start consuming messages:

```typescript
import { Server } from "ponos-ts";
import type { WorkerData, WorkerFunction } from "ponos-ts";

// Define a worker handler for a queue
const sendWelcomeEmail: WorkerFunction = async (job: WorkerData): Promise<void> => {
  if (!job.message) {
    throw new Error("Message required");
  }
  console.log(`Processing job message: ${job.message}`);
};

// Map queue names to task handlers
const tasks = new Map<string, WorkerFunction>([
  ["send-welcome-email", sendWelcomeEmail],
]);

// Initialize the Ponos Server
const server = new Server(tasks);

// Connect to RabbitMQ and start consuming queues
await server.start();
console.log("Ponos task server is running and consuming queues.");

// Graceful shutdown on process termination
process.on("SIGINT", async () => {
  console.log("Shutting down Ponos server...");
  await server.stop();
  console.log("Server stopped gracefully.");
  process.exit(0);
});
```

---

## Environment Configuration

Ponos automatically reads RabbitMQ connection options from environment variables when `options.rabbitmq` is not passed:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `RABBITMQ_URL` | Full AMQP/AMQPS connection URI (overrides discrete env vars) | `undefined` |
| `RABBITMQ_PROTOCOL` | Connection protocol (`amqp` or `amqps`) | `amqp` |
| `RABBITMQ_HOSTNAME` | Hostname of the RabbitMQ server | `localhost` |
| `RABBITMQ_PORT` | Broker port (`1–65535`) | `5672` (`5671` for `amqps`) |
| `RABBITMQ_USERNAME` | Username for RabbitMQ authentication | `""` (none) |
| `RABBITMQ_PASSWORD` | Password for RabbitMQ authentication | `""` (none) |
| `RABBITMQ_VHOST` | RabbitMQ virtual host | `/` |

*Note: By default Ponos prefixes queue names with `ponos.<queue-name>` (configurable via `options.name`) and sets channel `prefetch` to `1`.*

---

## API Reference

### `Server`

The core class responsible for managing tasks and RabbitMQ queue consumption.

#### `constructor(tasks?: Map<string, WorkerFunction>, options?: ServerOptions)`
Creates a new server instance with an optional queue-to-worker map and configuration options (`name`, `rabbitmq`, `prefetch`, `concurrency`, `taskTimeoutMs`, `maxRetries`, `initialRetryDelayMs`, `maxRetryDelayMs`, `onError`).

#### `server.start(): Promise<void>`
Connects to RabbitMQ, applies channel `prefetch`, asserts required queues, subscribes all handlers, and starts consuming messages.

#### `server.consume(): Promise<void>`
Subscribes any newly registered tasks and starts consuming messages on them.

#### `server.stop(): Promise<void>`
Unsubscribes from active consumer queues, requeues (`nack(true)`) unstarted buffered messages, awaits in-flight workers so they settle cleanly, waits for publisher confirms, and closes the RabbitMQ connection.

#### `server.setTask(queueName: string, task: WorkerFunction): this`
Dynamically registers or updates a worker function for a specific queue name. When called after `start()`, invoke `await server.consume()` to assert and start consuming the new queue.

---

### Types & Errors

#### `ServerOptions`
```typescript
interface ServerOptions {
  name?: string;
  rabbitmq?: string | RabbitMQConnectionConfig;
  prefetch?: number;
  concurrency?: number;
  taskTimeoutMs?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  onError?: (err: Error) => void;
}
```

#### `RabbitMQConnectionConfig`
```typescript
interface RabbitMQConnectionConfig {
  url?: string;
  protocol?: "amqp" | "amqps";
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
}
```

#### `WorkerData`
The expected shape of incoming task payloads:
```typescript
interface WorkerData {
  message: string;
}
```

#### `WorkerContext`
Metadata and cancellation signal passed as the second argument to handlers:
```typescript
interface WorkerContext {
  attempt: number;
  signal: AbortSignal;
  jobMeta?: Record<string, unknown>;
}
```

#### `WorkerFunction`
The signature required for task handler functions:
```typescript
type WorkerFunction = (
  data: WorkerData,
  context: WorkerContext,
) => Promise<unknown> | PromiseLike<unknown>;
```

#### `TaskFatalError`
Throw `TaskFatalError` inside a worker handler to fail immediately without retries and `nack(false)` the message:
```typescript
import { TaskFatalError } from "ponos-ts";

throw new TaskFatalError("Unrecoverable payload error");
```

---

## Development & Testing

### Building the Project

```bash
npm run build
```

### Running Tests

```bash
# Run unit tests & linter
npm test

# Run tests in watch mode
npm run test:watch

# Run functional integration tests (requires running RabbitMQ instance)
npm run test:functional

# Generate test coverage report
npm run test:coverage
```

### Linting & Formatting

```bash
npm run lint
```

---

## License

This project is licensed under the [MIT License](LICENSE).

---

> **Note**: This repository and its documentation have recently received a lot of care from AI / LLMs.


