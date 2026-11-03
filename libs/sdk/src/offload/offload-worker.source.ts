/** Each pool worker's script: it keeps only the passed env, marks the thread, registers tsx when present, then runs calls. */
export const OFFLOAD_WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
for (const key of Object.keys(process.env)) {
  if (!Object.prototype.hasOwnProperty.call(workerData.env, key)) delete process.env[key];
}
globalThis[Symbol.for('@frontmcp/sdk:offload-worker')] = true;
const hasOwn = (target, key) => target !== null && target !== undefined && Object.prototype.hasOwnProperty.call(target, key);
function registerTsx() {
  try {
    require(workerData.tsxApi.cjs).register();
  } catch {}
  return import(workerData.tsxApi.esm).then((tsx) => tsx.register()).catch(() => undefined);
}
const loaderReady = workerData.tsxApi ? registerTsx() : Promise.resolve();

function isFrontMcpError(error) {
  const brand = Symbol.for('@frontmcp/class-brand');
  for (let proto = Object.getPrototypeOf(error); proto !== null; proto = Object.getPrototypeOf(proto)) {
    const owner = Object.getOwnPropertyDescriptor(proto, 'constructor');
    if (owner && hasOwn(owner.value, brand) && owner.value[brand] === '@frontmcp/sdk:McpError') return true;
  }
  return false;
}

function plainData(read) {
  try {
    const value = read();
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function describeError(error) {
  if (error === null || typeof error !== 'object' || typeof error.message !== 'string') {
    return { name: 'Error', message: String(error) };
  }
  const isPublic = error.isPublic === true && isFrontMcpError(error);
  return {
    name: typeof error.name === 'string' ? error.name : 'Error',
    message: error.message,
    stack: typeof error.stack === 'string' ? error.stack : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
    isPublic,
    statusCode: typeof error.statusCode === 'number' ? error.statusCode : undefined,
    remedy: isPublic ? plainData(() => error.remedy) : undefined,
    jsonRpc: isPublic && typeof error.toJsonRpcError === 'function' ? plainData(() => error.toJsonRpcError()) : undefined,
  };
}

function exportedFunction(namespace, name, url) {
  const candidates = [namespace, namespace.default].filter((exports) => hasOwn(exports, name)).map((exports) => exports[name]);
  const found = candidates.find((candidate) => typeof candidate === 'function');
  if (!found) throw new TypeError(url + ' has no exported function "' + name + '"');
  return found;
}

const log = (level, text) => parentPort.postMessage({ type: 'log', level, text });

async function run(task) {
  await loaderReady;
  const namespace = await import(task.url);
  if (task.kind === 'job') {
    const runners = globalThis[Symbol.for('@frontmcp/sdk:worker-jobs')];
    const runner = runners && runners.get(task.key);
    if (!runner) throw new Error('Importing ' + task.url + ' in a worker registered no worker job "' + task.name + '"');
    parentPort.postMessage({ type: 'started' });
    return runner.run(task.input, task.attempt, log, (progress) => parentPort.postMessage({ type: 'progress', progress }));
  }
  if (task.kind === 'function') {
    const fn = exportedFunction(namespace, task.exportName, task.url);
    parentPort.postMessage({ type: 'started' });
    return fn(...task.args);
  }
  const readers = globalThis[Symbol.for('@frontmcp/sdk:worker-resources')];
  const reader = readers && readers.get(task.key);
  if (!reader) throw new Error('Importing ' + task.url + ' in a worker registered no worker resource "' + task.name + '"');
  parentPort.postMessage({ type: 'started' });
  return reader.read(task.uri, task.params, log);
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
