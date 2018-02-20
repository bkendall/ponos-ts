"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
class PonosWorker {
    constructor(attempt, job, queue, task) {
        this.attempt = attempt;
        this.job = job;
        this.queue = queue;
        this.task = task;
        this.msTimeout = 500;
    }
    static create(attempt, job, queue, task) {
        return new PonosWorker(attempt, job, queue, task);
    }
    run() {
        // TODO(bkendall): there's more error handling to be done.
        return Promise.bind(this)
            .then(this.wrapTask)
            .then(this.handleTaskSuccess)
            .catch((err) => {
            console.error(err);
            throw err;
        })
            .catch(this.retryWithDelay);
    }
    // TODO(bkendall): validate a job.
    wrapTask() {
        let taskPromise = Promise.try(() => {
            return this.task(this.job);
        });
        if (this.msTimeout) {
            taskPromise = taskPromise.timeout(this.msTimeout);
        }
        return taskPromise;
    }
    retryWithDelay(err) {
        // TODO(bkendall): actually delay us some amount.
        return Promise.delay(200)
            .then(() => {
            return this.run();
        });
    }
    handleTaskSuccess() {
        // TODO(bkendall): do something more useful here.
        // console.log('success');
    }
}
exports.PonosWorker = PonosWorker;
//# sourceMappingURL=worker.js.map