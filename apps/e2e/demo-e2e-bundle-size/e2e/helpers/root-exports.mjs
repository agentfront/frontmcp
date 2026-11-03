// Loads an SDK entry with require() or import() and prints, as JSON, the kind of each of its exports: node root-exports.mjs <entry> <require|import>
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [entry, loader] = process.argv.slice(2);
const sdk = loader === 'require' ? createRequire(import.meta.url)(entry) : await import(pathToFileURL(entry).href);

function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'function') {
    return /^class\b/.test(Function.prototype.toString.call(value)) ? 'class' : 'function';
  }
  return typeof value;
}

const kinds = Object.fromEntries(
  Object.keys(sdk)
    .sort()
    .map((name) => [name, kindOf(sdk[name])]),
);
process.stdout.write(JSON.stringify(kinds));
