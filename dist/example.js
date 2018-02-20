"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
const index_1 = require("./index");
const basicWorker = (job) => {
    return Promise.try(() => {
        if (!job.message) {
            throw new Error(`message is required`);
        }
        console.log(`hello world: ${job.message}`);
    });
};
const server = new index_1.Server();
server.setTask(`basic-queue-worker`, basicWorker);
server.start()
    .then(() => { console.log(`server started`); })
    .catch((err) => { console.error(`server error: ${err}`); });
process.on(`SIGINT`, () => {
    server.stop()
        .then(() => { console.log(`server stopped`); })
        .catch((err) => { console.error(`server stop error: ${err}`); });
});
//# sourceMappingURL=example.js.map