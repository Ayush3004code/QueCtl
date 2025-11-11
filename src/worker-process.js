// Standalone worker process entry point
const { Worker } = require('./worker');

const workerId = process.argv[2] || null;
const worker = new Worker(workerId);
worker.start();

