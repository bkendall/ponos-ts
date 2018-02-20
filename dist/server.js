"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
const rabbitmq_1 = require("./rabbitmq");
const worker_1 = require("./worker");
class Server {
    constructor() {
        this.workQueues = new Map();
        this.tasks = new Map();
        // this.events = new Map();
        this.rabbitmq = new rabbitmq_1.RabbitMQ({
            name: 'ponos',
        });
    }
    consume() {
        return this.rabbitmq.consume().return();
    }
    start() {
        return this.rabbitmq.connect()
            .then(() => {
            return this.subscribeAll();
        })
            .then(() => {
            return this.consume();
        })
            .catch((err) => {
            console.error('start error', err);
            throw err;
        });
    }
    stop() {
        return this.rabbitmq.unsubscribe()
            .then(() => {
            return this.rabbitmq.disconnect();
        })
            .catch((err) => {
            console.error('stop error', err);
            throw err;
        });
    }
    setTask(queueName, task) {
        this.workQueues.set(queueName, []);
        this.tasks.set(queueName, task);
        return this;
    }
    subscribeAll() {
        return Promise.map(this.tasks.keys(), (queue) => {
            return this.rabbitmq.subscribeToQueue(queue, (job, jobMeta, done) => {
                this.enqueue(queue, this.tasks.get(queue), job, jobMeta, done);
            });
        })
            .return();
    }
    enqueue(name, worker, job, jobMeta, done) {
        this.workQueues.get(name).push(() => {
            this.runWorker(name, worker, job, jobMeta, done);
        });
        if (this.workQueues.get(name).length == 1) {
            this.workLoop(name);
        }
    }
    workLoop(name) {
        return Promise.try(() => {
            const worker = this.workQueues.get(name).pop();
            if (worker) {
                worker();
                this.workLoop(name);
            }
        });
    }
    runWorker(queueName, handler, job, jobMeta, done) {
        const worker = worker_1.PonosWorker.create(0, job, queueName, handler);
        return worker.run()
            .finally(() => { done(); });
    }
}
exports.Server = Server;
//# sourceMappingURL=server.js.map