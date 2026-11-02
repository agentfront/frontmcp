// Loads the SDK's CommonJS build with esbuild's module-init helper wrapped, so the source modules it initializes are
// recorded, then prints, as JSON, the ones initialized by loading it and by each step after:
// node initialized-modules.cjs <dist/index.js> [read:<export>,...] [fetch:<METHOD> <path>]...
const Module = require('node:module');
const { readFileSync, realpathSync } = require('node:fs');
const path = require('node:path');

const ESM_INIT_HELPER =
  'var __esm=(fn,res,err)=>function __init(){if(err)throw err[0];try{return fn&&(res=(0,fn[__getOwnPropNames(fn)[0]])(fn=0)),res}catch(e){throw err=[e],e}};';
const RECORD_INITS =
  'var __esmUnrecorded=__esm;__esm=(fn,res,err)=>{const source=__getOwnPropNames(fn)[0];const init=__esmUnrecorded(fn,res,err);return function(){globalThis.__sdkInitialized.add(source);return init()}};';

const [entryArg, ...steps] = process.argv.slice(2);
const entry = realpathSync(path.resolve(entryArg));
const code = readFileSync(entry, 'utf8');
if (!code.includes(ESM_INIT_HELPER)) throw new Error(`esbuild's __esm helper not found in ${entry}`);

const initialized = (globalThis.__sdkInitialized = new Set());
const sdkModule = new Module(entry, module);
sdkModule.filename = entry;
sdkModule.paths = Module._nodeModulePaths(path.dirname(entry));
require.cache[entry] = sdkModule;
sdkModule._compile(code.replace(ESM_INIT_HELPER, ESM_INIT_HELPER + RECORD_INITS), entry);
sdkModule.loaded = true;
const sdk = sdkModule.exports;

let seen = new Set();
function initializedSince() {
  const added = [...initialized].filter((source) => !seen.has(source));
  seen = new Set(initialized);
  return added;
}

async function main() {
  const report = [{ step: 'load', initialized: initializedSince() }];
  let handler;
  for (const step of steps) {
    const [kind, arg] = [step.slice(0, step.indexOf(':')), step.slice(step.indexOf(':') + 1)];
    if (kind === 'read') {
      for (const name of arg.split(',')) void sdk[name];
    } else if (kind === 'fetch') {
      handler ??= await sdk.FrontMcpInstance.createFetchHandler({
        info: { name: 'initialized-modules', version: '1.0.0' },
        apps: [sdk.app({ id: 'empty', name: 'Empty' })],
        logging: { level: sdk.LogLevel.Off },
      });
      if (arg) {
        const [method, url] = arg.split(' ');
        await (await handler(new Request(`http://localhost${url}`, { method }))).arrayBuffer();
      }
    } else {
      throw new Error(`unknown step ${step}`);
    }
    report.push({ step, initialized: initializedSince() });
  }
  process.stdout.write(JSON.stringify(report));
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(String(error?.stack ?? error));
    process.exit(1);
  },
);
