import {expect} from 'chai';
import * as EventEmitter from 'events';
import * as Promise from 'bluebird';
import * as sinon from 'sinon';
import {RabbitMQ} from '../src/rabbitmq';
import {Server, WorkerData, WorkerFunction} from '../src/index';

describe('Simple Example', () => {
  let server: Server;
  let rabbitmq: RabbitMQ;
  let jobEmitter: EventEmitter = new EventEmitter();
  const basicWorker: WorkerFunction = (job: WorkerData): Promise<void> => {
    return Promise.try(() => {
      console.log('worker got it');
      jobEmitter.emit('done');
    });
  };

  before(() => {
    rabbitmq = new RabbitMQ({
      name: 'ponos',
      tasks: new Set([
        'basic-queue-worker',
      ]),
    });
    return rabbitmq.connect();
  });

  it('should call our basic worker', () => {
    server = new Server(new Map([
      ['basic-queue-worker', basicWorker],
    ]));
    const jobPromise = Promise.fromCallback((done) => {
      console.log('waiting for emit');
      jobEmitter.on('done', () => { done(''); });
    });
    return server.start()
      .then(() => {
        console.log('waiting for publish');
        return rabbitmq.publishTask('basic-queue-worker', {});
      })
      .then(() => {
        console.log('waiting on promise');
        return jobPromise;
      })
      .then(() => {
        expect(jobPromise).to.eventually.be.fulfilled;
      })
      .catch((err) => {
        console.error(err);
        throw err;
      })
      .finally(() => {
        return Promise.all([
          rabbitmq.disconnect(),
          server.stop(),
        ]);
      });
  });
});
