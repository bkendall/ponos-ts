import * as Promise from "bluebird";
import * as sinon from 'sinon';
import {expect} from 'chai';
import {PonosWorker, WorkerData, WorkerFunction} from '../src/worker';

describe('PonosWorker', () => {
  describe('create', () => {
    it('should return a PonosWorker', () => {
      const newWorker = PonosWorker.create(
        0,
        {message: ''},
        'someQueue',
        (data) => Promise.resolve());

      expect(newWorker).to.be.an.instanceof(PonosWorker);
    });
  });

  describe('run', () => {
    it('should run our given task', () => {
      const taskHandler = sinon.stub().resolves();
      const worker = PonosWorker.create(
        0,
        {message: 'foo'},
        'someQueue',
        taskHandler);

      const runPromise = worker.run();

      return expect(runPromise).to.eventually.be.fulfilled
        .then(() => {
          sinon.assert.calledOnce(taskHandler);
        });
    });

    it('should provide data to our task', () => {
      const taskHandler = sinon.stub().resolves();
      const worker = PonosWorker.create(
        0,
        {message: 'foo'},
        'someQueue',
        taskHandler);

      const runPromise = worker.run();

      return expect(runPromise).to.eventually.be.fulfilled
        .then(() => {
          sinon.assert.calledWithExactly(taskHandler, {message: 'foo'});
        });
    });
  });
});
