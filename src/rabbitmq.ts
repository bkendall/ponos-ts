import * as amqp from "amqplib";
import * as Promise from "bluebird";

export type RabbitMessageHandler = (
  job: object,
  jobMeta: object,
  done: () => void
) => void;

export interface RabbitMQOpts {
  name: string;
  tasks: Set<string>;
}

export class RabbitMQ {
  private channel: amqp.Channel;
  private connection: amqp.Connection;
  private consuming: Map<string, string>;
  private hostname: string;
  private name: string;
  private password: string;
  private port: number;
  private publishChannel: amqp.ConfirmChannel;
  private subscribed: Set<string>;
  private subscriptions: Map<string, RabbitMessageHandler>;
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

  connect(): Promise<void> {
    let authString = "";
    if (this.username && this.password) {
      authString = `${this.username}:${this.password}@`;
    }
    const url = `amqp://${authString}${this.hostname}:${this.port}`;
    console.log(url);
    return Promise.resolve(amqp.connect(url, {}))
      .catch((err) => {
        console.error("connect", err);
        throw err;
      })
      .then((conn) => {
        this.connection = conn;
        return Promise.resolve(this.connection.createChannel()).catch((err) => {
          console.error("createChannel", err);
          throw err;
        });
      })
      .then((channel) => {
        this.channel = channel;
        return Promise.resolve(this.connection.createConfirmChannel()).catch(
          (err) => {
            console.error("createConfirmChannel", err);
            throw err;
          }
        );
      })
      .then((channel) => {
        this.publishChannel = channel;
      })
      .then(() => {
        return Promise.each(this.tasks, (queue) => {
          return this.assertQueue(`${this.name}.${queue}`);
        });
      })
      .return();
  }

  consume(): Promise<void> {
    const subscriptions = this.subscriptions;
    this.subscriptions = new Map();
    const channel = this.channel;
    return Promise.map(subscriptions.keys(), (queue) => {
      const handler = subscriptions.get(queue);
      if (this.consuming.has(queue)) {
        console.log(`already consuming queue ${queue}`);
        return;
      }
      const wrapper = (msg: amqp.Message) => {
        let job;
        const jobMeta = msg.properties || {};
        try {
          job = JSON.parse(`${msg.content}`);
        } catch (err) {
          console.error(`content not valid json`);
          return channel.ack(msg);
        }
        handler(job, jobMeta, () => {
          channel.ack(msg);
        });
      };
      return Promise.resolve(this.channel.consume(queue, wrapper)).then(
        (consumeInfo) => {
          this.consuming.set(queue, consumeInfo.consumerTag);
        }
      );
    }).return();
  }

  subscribeToQueue(
    queue: string,
    handler: RabbitMessageHandler
  ): Promise<void> {
    const queueName = `${this.name}.${queue}`;
    return Promise.try(() => {
      this.subscriptions.set(queueName, handler);
      this.subscribed.add(`queue:::${queueName}`);
    });
  }

  publishTask(queue: string, content: object): Promise<void> {
    return Promise.try(() => {
      const queueName = `${this.name}.${queue}`;
      const payload = Buffer.from(JSON.stringify({}));
      return Promise.resolve(
        this.publishChannel.sendToQueue(queueName, payload)
      ).return();
    });
  }

  unsubscribe(): Promise<void> {
    const consuming = this.consuming;
    return Promise.map(consuming.keys(), (queue) => {
      const consumerTag = consuming.get(queue);
      return Promise.resolve(this.channel.cancel(consumerTag)).then(() => {
        this.consuming.delete(queue);
      });
    }).return();
  }

  disconnect(): Promise<void> {
    return Promise.resolve(this.publishChannel.waitForConfirms()).then(() =>
      Promise.resolve(this.connection.close())
    );
    // TODO(bkendall): Set clean state after this.
  }

  private assertQueue(queue: string): Promise<void> {
    return Promise.resolve(this.channel.assertQueue(queue)).return();
  }

  private setCleanState(): void {
    delete this.channel;
    delete this.connection;
    this.subscriptions = new Map();
    this.subscribed = new Set();
    this.consuming = new Map();
  }
}
