# Ponos

> An opinionated, lightweight task server for Node.js & TypeScript, powered by RabbitMQ.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)

**Ponos** simplifies background task processing by providing a structured, type-safe worker server that consumes jobs from RabbitMQ queues with automated connection handling, message routing, and task execution.

---

## Features

- **Typed Task Handlers**: Full TypeScript support with clean types (`WorkerFunction`, `WorkerData`).
- **Sequential Queue Processing**: In-memory task queuing ensures predictable worker execution.
- **Automated Acking**: Handlers automatically acknowledge messages upon completion or queue failure recovery.
- **Built-in Timeout & Retries**: Automatic execution timeouts and retry mechanism for task resilience.
- **Graceful Shutdown**: Effortless queue unsubscription and clean RabbitMQ connection termination.
- **Simple Configuration**: Environment-based RabbitMQ setup (`RABBITMQ_HOSTNAME`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD`).

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

Ponos automatically reads RabbitMQ connection options from environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `RABBITMQ_HOSTNAME` | Hostname of the RabbitMQ server | `localhost` |
| `RABBITMQ_USERNAME` | Username for RabbitMQ authentication | `""` (none) |
| `RABBITMQ_PASSWORD` | Password for RabbitMQ authentication | `""` (none) |

*Note: Ponos connects over default AMQP port `5672` and prefixes queue names with `ponos.<queue-name>`.*

---

## API Reference

### `Server`

The core class responsible for managing tasks and RabbitMQ queue consumption.

#### `constructor(tasks: Map<string, WorkerFunction>)`
Creates a new server instance with the given queue-to-worker map.

#### `server.start(): Promise<void>`
Connects to RabbitMQ, asserts required queues, subscribes all handlers, and starts consuming messages.

#### `server.stop(): Promise<void>`
Unsubscribes from active consumer queues, waits for confirms, and closes the RabbitMQ connection.

#### `server.setTask(queueName: string, task: WorkerFunction): this`
Dynamically registers or updates a worker function for a specific queue name.

---

### Types

#### `WorkerData`
The expected shape of incoming task payloads:
```typescript
interface WorkerData {
  message: string;
}
```

#### `WorkerFunction`
The signature required for task handler functions:
```typescript
type WorkerFunction = (data: WorkerData) => Promise<unknown> | PromiseLike<unknown>;
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


