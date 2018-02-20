import * as Promise from 'bluebird';
import {Server, WorkerData, WorkerFunction} from './index';

const basicWorker: WorkerFunction = (job: WorkerData): Promise<void> => {
  return Promise.try(() => {
    if (!job.message) {
      throw new Error('message is required');
    }
    console.log(`hello world: ${job.message}`);
  });
};

const server = new Server();
server.setTask('basic-queue-worker', basicWorker);
server.start()
  .then(() => { console.log('server started'); })
  .catch((err) => { console.error(`server error: ${err}`); });

process.on('SIGINT', () => {
  server.stop()
    .then(() => { console.log('server stopped'); })
    .catch((err) => { console.error(`server stop error: ${err}`); });
});
