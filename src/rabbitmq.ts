import amqp from "amqplib";

export type RabbitMessageHandler = (
  job: any,
  jobMeta: object,
  done: () => void,
) => void;

export interface RabbitMQConnectionConfig {
  url?: string;
  protocol?: "amqp" | "amqps";
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
}

export interface RabbitMQOpts {
  name?: string;
  tasks?: Iterable<string>;
  connection?: string | RabbitMQConnectionConfig;
  prefetch?: number;
  onError?: (err: Error) => void;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function parsePort(
  explicitPort: number | undefined,
  envPort: string | undefined,
  protocol: "amqp" | "amqps",
): number {
  if (explicitPort !== undefined) {
    if (
      !Number.isInteger(explicitPort) ||
      explicitPort < 1 ||
      explicitPort > 65535
    ) {
      throw new RangeError(`Invalid RabbitMQ port: ${explicitPort}`);
    }
    return explicitPort;
  }

  if (envPort !== undefined && envPort !== "") {
    const parsed = Number(envPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new RangeError(`Invalid RABBITMQ_PORT: ${envPort}`);
    }
    return parsed;
  }

  return protocol === "amqps" ? 5671 : 5672;
}

function resolveConnectTarget(
  connectionConfig?: string | RabbitMQConnectionConfig,
): string | amqp.Options.Connect {
  if (typeof connectionConfig === "string" && connectionConfig.length > 0) {
    return connectionConfig;
  }

  const configObj =
    typeof connectionConfig === "object" && connectionConfig !== null
      ? connectionConfig
      : undefined;

  if (configObj?.url) {
    return configObj.url;
  }

  if (!connectionConfig && process.env.RABBITMQ_URL) {
    return process.env.RABBITMQ_URL;
  }

  const protocolRaw =
    configObj?.protocol ?? (process.env.RABBITMQ_PROTOCOL || "amqp");
  if (protocolRaw !== "amqp" && protocolRaw !== "amqps") {
    throw new Error(`Unsupported RabbitMQ protocol: ${String(protocolRaw)}`);
  }

  const hostname =
    configObj?.hostname ?? (process.env.RABBITMQ_HOSTNAME || "localhost");
  const port = parsePort(
    configObj?.port,
    process.env.RABBITMQ_PORT,
    protocolRaw,
  );
  const vhost = configObj?.vhost ?? (process.env.RABBITMQ_VHOST || "/");
  const username = configObj?.username ?? (process.env.RABBITMQ_USERNAME || "");
  const password = configObj?.password ?? (process.env.RABBITMQ_PASSWORD || "");

  const options: amqp.Options.Connect = {
    protocol: protocolRaw,
    hostname,
    port,
    vhost,
  };

  if (username) {
    options.username = username;
    options.password = password;
  }

  return options;
}

export class RabbitMQ {
  private assertedQueues: Set<string> = new Set();
  private channel?: amqp.Channel;
  private closing = false;
  private connectTarget: string | amqp.Options.Connect;
  private connection?: amqp.ChannelModel;
  private consuming: Map<string, string> = new Map();
  private name: string;
  private onError: (err: Error) => void;
  private prefetchCount: number;
  private publishChannel?: amqp.ConfirmChannel;
  private subscribed: Set<string> = new Set();
  private subscriptions: Map<string, RabbitMessageHandler> = new Map();
  private tasks: Set<string>;

  constructor(opts: RabbitMQOpts) {
    this.name = opts.name || "ponos";
    this.tasks = new Set(opts.tasks ?? []);

    const prefetch = opts.prefetch ?? 1;
    if (!Number.isInteger(prefetch) || prefetch < 1) {
      throw new RangeError(
        `prefetch must be a positive integer, received ${prefetch}`,
      );
    }
    this.prefetchCount = prefetch;
    this.connectTarget = resolveConnectTarget(opts.connection);
    this.onError =
      opts.onError ??
      ((err: Error): void => {
        console.error("RabbitMQ error", err);
      });

    this.setCleanState();
  }

  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.connectTarget, {});
      this.connection.on("error", (err: unknown) => {
        this.onError(toError(err));
      });
      this.connection.on("close", () => {
        if (!this.closing) {
          this.onError(new Error("RabbitMQ connection closed unexpectedly"));
        }
        this.setCleanState();
      });

      this.channel = await this.connection.createChannel();
      this.channel.on("error", (err: unknown) => {
        this.onError(toError(err));
      });
      await this.channel.prefetch(this.prefetchCount);

      this.publishChannel = await this.connection.createConfirmChannel();
      this.publishChannel.on("error", (err: unknown) => {
        this.onError(toError(err));
      });

      for (const queue of this.tasks) {
        await this.assertQueue(`${this.name}.${queue}`);
      }
    } catch (err: unknown) {
      if (this.connection) {
        this.closing = true;
        try {
          await this.connection.close();
        } catch {
          // Ignore close errors while cleaning up a failed connect attempt.
        } finally {
          this.closing = false;
        }
      }
      this.setCleanState();
      console.error("connect error", err);
      throw err;
    }
  }

  async consume(): Promise<void> {
    const subscriptions = this.subscriptions;
    this.subscriptions = new Map();
    const channel = this.channel;
    if (!channel) {
      throw new Error("Channel not initialized");
    }
    for (const [queue, handler] of subscriptions) {
      if (this.consuming.has(queue)) {
        console.log(`already consuming queue ${queue}`);
        continue;
      }
      const wrapper = (msg: amqp.ConsumeMessage | null): void => {
        if (!msg) return;
        let job: any;
        const jobMeta = msg.properties || {};
        try {
          job = JSON.parse(`${msg.content}`);
        } catch {
          console.error(`content not valid json`);
          return channel.ack(msg);
        }
        handler(job, jobMeta, () => {
          channel.ack(msg);
        });
      };
      const consumeInfo = await channel.consume(queue, wrapper);
      this.consuming.set(queue, consumeInfo.consumerTag);
    }
  }

  async subscribeToQueue(
    queue: string,
    handler: RabbitMessageHandler,
  ): Promise<void> {
    const queueName = `${this.name}.${queue}`;
    this.subscriptions.set(queueName, handler);
    this.subscribed.add(`queue:::${queueName}`);
  }

  async publishTask(queue: string, content: object): Promise<void> {
    const queueName = `${this.name}.${queue}`;
    const payload = Buffer.from(JSON.stringify(content));
    if (!this.publishChannel) {
      throw new Error("Publish channel not initialized");
    }
    this.publishChannel.sendToQueue(queueName, payload);
  }

  async unsubscribe(): Promise<void> {
    const consuming = this.consuming;
    for (const [queue, consumerTag] of consuming) {
      if (consumerTag && this.channel) {
        await this.channel.cancel(consumerTag);
        this.consuming.delete(queue);
      }
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connection) {
      this.setCleanState();
      return;
    }

    this.closing = true;
    try {
      if (this.publishChannel) {
        await this.publishChannel.waitForConfirms();
      }
      await this.connection.close();
    } finally {
      this.closing = false;
      this.setCleanState();
    }
  }

  private async assertQueue(queue: string): Promise<void> {
    if (!this.channel) {
      throw new Error("Channel not initialized");
    }
    if (this.assertedQueues.has(queue)) {
      return;
    }
    await this.channel.assertQueue(queue);
    this.assertedQueues.add(queue);
  }

  private setCleanState(): void {
    this.assertedQueues = new Set();
    this.channel = undefined;
    this.connection = undefined;
    this.publishChannel = undefined;
    this.subscriptions = new Map();
    this.subscribed = new Set();
    this.consuming = new Map();
  }
}
