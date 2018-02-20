"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const amqp = require("amqplib");
const Promise = require("bluebird");
class RabbitMQ {
    constructor(opts) {
        this.name = 'ponos';
        this.hostname = process.env.RABBITMQ_HOSTNAME || 'localhost';
        this.port = 5672;
        this.username = process.env.RABBITMQ_USERNAME || '';
        this.password = process.env.RABBITMQ_PASSWORD || '';
        this.setCleanState();
    }
    connect() {
        let authString = '';
        if (this.username && this.password) {
            authString = `${this.username}:${this.password}@`;
        }
        const url = `amqp://${authString}${this.hostname}:${this.port}`;
        console.log(url);
        return Promise.resolve(amqp.connect(url, {}))
            .catch((err) => {
            console.error('connect', err);
            throw err;
        })
            .then((conn) => {
            this.connection = conn;
            return Promise.resolve(this.connection.createChannel())
                .catch((err) => {
                console.error('createChannel', err);
                throw err;
            });
        })
            .then((channel) => {
            this.channel = channel;
            return Promise.resolve(this.connection.createConfirmChannel())
                .catch((err) => {
                console.error('createConfirmChannel', err);
                throw err;
            });
        })
            .then((channel) => {
            this.publishChannel = channel;
        });
        // TODO(bkendall): Assert Queues and Exchanges.
    }
    consume() {
        const subscriptions = this.subscriptions;
        this.subscriptions = new Map();
        const channel = this.channel;
        return Promise.map(subscriptions.keys(), (queue) => {
            const handler = subscriptions.get(queue);
            if (this.consuming.has(queue)) {
                console.log(`already consuming queue ${queue}`);
                return;
            }
            const wrapper = (msg) => {
                let job;
                const jobMeta = msg.properties || {};
                try {
                    job = JSON.parse(`${msg.content}`);
                }
                catch (err) {
                    console.error(`content not valid json`);
                    return channel.ack(msg);
                }
                handler(job, jobMeta, () => {
                    channel.ack(msg);
                });
            };
            return Promise.resolve(this.channel.consume(queue, wrapper))
                .then((consumeInfo) => {
                this.consuming.set(queue, consumeInfo.consumerTag);
            });
        })
            .return();
    }
    subscribeToQueue(queue, handler) {
        const queueName = `${this.name}.${queue}`;
        return Promise.try(() => {
            this.subscriptions.set(queueName, handler);
            this.subscribed.add(`queue:::${queueName}`);
        });
    }
    publishTask(queue, content) {
        return Promise.try(() => {
            const queueName = `${this.name}.${queue}`;
            const payload = Buffer.from(JSON.stringify({}));
            return Promise
                .resolve(this.publishChannel.sendToQueue(queueName, payload))
                .return();
        });
    }
    unsubscribe() {
        const consuming = this.consuming;
        return Promise.map(consuming.keys(), (queue) => {
            const consumerTag = consuming.get(queue);
            return Promise.resolve(this.channel.cancel(consumerTag))
                .then(() => {
                this.consuming.delete(queue);
            });
        })
            .return();
    }
    disconnect() {
        return Promise.resolve(this.publishChannel.waitForConfirms())
            .then(() => (Promise.resolve(this.connection.close())));
        // TODO(bkendall): Set clean state after this.
    }
    setCleanState() {
        delete this.channel;
        delete this.connection;
        this.subscriptions = new Map();
        this.subscribed = new Set();
        this.consuming = new Map();
    }
}
exports.RabbitMQ = RabbitMQ;
//# sourceMappingURL=rabbitmq.js.map