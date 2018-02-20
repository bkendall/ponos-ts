"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sinon = require("sinon");
const chai_1 = require("chai");
const worker_1 = require("../src/worker");
describe('PonosWorker', () => {
    describe('create', () => {
        it('should return a PonosWorker', () => {
            const newWorker = worker_1.PonosWorker.create(0, { message: '' }, 'someQueue', (data) => { });
            chai_1.expect(newWorker).to.be.an.instanceof(worker_1.PonosWorker);
        });
    });
    describe('run', () => {
        it('should run our given task', () => {
            const taskHandler = sinon.stub().resolves();
            const worker = worker_1.PonosWorker.create(0, { message: 'foo' }, 'someQueue', taskHandler);
            const runPromise = worker.run();
            return chai_1.expect(runPromise).to.eventually.be.fulfilled
                .then(() => {
                sinon.assert.calledOnce(taskHandler);
            });
        });
        it('should provide data to our task', () => {
            const taskHandler = sinon.stub().resolves();
            const worker = worker_1.PonosWorker.create(0, { message: 'foo' }, 'someQueue', taskHandler);
            const runPromise = worker.run();
            return chai_1.expect(runPromise).to.eventually.be.fulfilled
                .then(() => {
                sinon.assert.calledWithExactly(taskHandler, { message: 'foo' });
            });
        });
    });
});
//# sourceMappingURL=worker.js.map