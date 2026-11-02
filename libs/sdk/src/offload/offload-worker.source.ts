/** Each pool worker's script: it keeps only the passed env, marks the thread, registers tsx when present, then runs calls. */
export const OFFLOAD_WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
for (const key of Object.keys(process.env)) {
  if (!Object.prototype.hasOwnProperty.call(workerData.env, key)) delete process.env[key];
}
globalThis[Symbol.for('@frontmcp/sdk:offload-worker')] = true;
if (workerData.tsxApi) require(workerData.tsxApi.cjs).register();
const loaderReady = workerData.tsxApi
  ? import(workerData.tsxApi.esm).then((tsx) => tsx.register())
  : Promise.resolve();

function describeError(error) {
  if (error === null || typeof error !== 'object' || typeof error.message !== 'string') {
    return { name: 'Error', message: String(error) };
  }
  return {
    name: typeof error.name === 'string' ? error.name : 'Error',
    message: error.message,
    stack: typeof error.stack === 'string' ? error.stack : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
    isPublic: error.isPublic === true,
    statusCode: typeof error.statusCode === 'number' ? error.statusCode : undefined,
  };
}

function exportedFunction(namespace, name, url) {
  const candidates = [namespace[name], namespace.default && namespace.default[name]];
  const found = candidates.find((candidate) => typeof candidate === 'function');
  if (!found) throw new TypeError(url + ' has no exported function "' + name + '"');
  return found;
}

async function run(task) {
  await loaderReady;
  const namespace = await import(task.url);
  if (task.kind === 'function') {
    const fn = exportedFunction(namespace, task.exportName, task.url);
    parentPort.postMessage({ type: 'started' });
    return fn(...task.args);
  }
  const readers = globalThis[Symbol.for('@frontmcp/sdk:worker-resources')];
  const reader = readers && readers.get(task.key);
  if (!reader) throw new Error('Importing ' + task.url + ' in a worker registered no worker resource "' + task.name + '"');
  parentPort.postMessage({ type: 'started' });
  return reader.read(task.uri, task.params, (level, text) => parentPort.postMessage({ type: 'log', level, text }));
}

parentPort.on('message', (task) => {
  run(task).then(
    (value) => {
      try {
        parentPort.postMessage({ type: 'result', value });
      } catch (error) {
        parentPort.postMessage({ type: 'error', notCloneable: true, error: describeError(error) });
      }
    },
    (error) => parentPort.postMessage({ type: 'error', error: describeError(error) }),
  );
});
`;
