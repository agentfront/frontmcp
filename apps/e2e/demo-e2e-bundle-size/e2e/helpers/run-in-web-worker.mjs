// Runs a Web Worker bundle without the globals a browser worker lacks and prints the message it posts as JSON: node run-in-web-worker.mjs <workerBundle>
import { pathToFileURL } from 'node:url';

const [workerBundle] = process.argv.slice(2);
const stdout = process.stdout;
const exit = process.exit.bind(process);

globalThis.self = globalThis;
globalThis.postMessage = (message) => stdout.write(JSON.stringify(message), () => exit(0));
for (const name of ['process', 'Buffer', 'global', 'setImmediate', 'clearImmediate']) delete globalThis[name];

await import(pathToFileURL(workerBundle).href);
