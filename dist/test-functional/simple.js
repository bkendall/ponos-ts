"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const EventEmitter = require("events");
const Promise = require("bluebird");
const rabbitmq_1 = require("../src/rabbitmq");
const index_1 = require("../src/index");
describe('Simple Example', () => {
    let server;
    let rabbitmq;
    let jobEmitter = new EventEmitter();
    const basicWorker = (job) => {
        return Promise.try(() => {
            console.log('worker got it');
            jobEmitter.emit('done');
        });
    };
    before(() => {
        rabbitmq = new rabbitmq_1.RabbitMQ({
            name: 'ponos-test',
        });
        return rabbitmq.connect();
    });
    it('should call our basic worker', () => {
        server = new index_1.Server();
        server.setTask('basic-queue-worker', basicWorker);
        const jobPromise = Promise.fromCallback((done) => {
            console.log('waiting for emit');
            jobEmitter.on('done', () => { done(''); });
        });
        return server.start()
            .then(() => {
            console.log('waiting for publish');
            return rabbitmq.publishTask('ponos-test.basic-queue-worker', {});
        })
            .then(() => {
            console.log('waiting on promise');
            return jobPromise;
        })
            .then(() => {
            chai_1.expect(jobPromise).to.eventually.be.fulfilled;
        })
            .finally(() => {
            return Promise.all([
                rabbitmq.disconnect(),
                server.stop(),
            ]);
        });
    });
});
//# sourceMappingURL=simple.js.map