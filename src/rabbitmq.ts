import * as amqp from "amqplib";

export type RabbitMessageHandler = (
  job: any,
  jobMeta: object,
  done: () => void,
) => void;

export interface RabbitMQOpts {
  name: string;
  tasks: Set<string>;
}

export class RabbitMQ {
  private channel?: amqp.Channel;
  private connection?: amqp.ChannelModel;
  private consuming: Map<string, string> = new Map();

  private hostname: string;
  private name: string;
  private password: string;
  private port: number;
  private publishChannel?: amqp.ConfirmChannel;
  private subscribed: Set<string> = new Set();
  private subscriptions: Map<string, RabbitMessageHandler> = new Map();
  private tasks: Set<string>;
  private username: string;

  constructor(opts: RabbitMQOpts) {
    this.name = opts.name || "ponos";
    this.hostname = process.env.RABBITMQ_HOSTNAME || "localhost";
    this.port = 5672;
    this.username = process.env.RABBITMQ_USERNAME || "";
    this.password = process.env.RABBITMQ_PASSWORD || "";
    this.tasks = opts.tasks || new Set();
    this.setCleanState();
  }

  async connect(): Promise<void> {
    let authString = "";
    if (this.username && this.password) {
      authString = `${this.username}:${this.password}@`;
    }
    const url = `amqp://${authString}${this.hostname}:${this.port}`;
    console.log(url);
    try {
      this.connection = await amqp.connect(url, {});
      this.channel = await this.connection.createChannel();
      this.publishChannel = await this.connection.createConfirmChannel();

      for (const queue of this.tasks) {
        await this.assertQueue(`${this.name}.${queue}`);
      }
    } catch (err: unknown) {
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
    if (!this.publishChannel || !this.connection) {
      return;
    }
    await this.publishChannel.waitForConfirms();
    await this.connection.close();
    // TODO(bkendall): Set clean state after this.
  }

  private async assertQueue(queue: string): Promise<void> {
    if (!this.channel) {
      throw new Error("Channel not initialized");
    }
    await this.channel.assertQueue(queue);
  }

  private setCleanState(): void {
    this.channel = undefined;
    this.connection = undefined;
    this.publishChannel = undefined;
    this.subscriptions = new Map();
    this.subscribed = new Set();
    this.consuming = new Map();
  }
}
