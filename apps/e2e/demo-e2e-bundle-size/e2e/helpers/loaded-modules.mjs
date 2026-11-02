// Imports a module and prints, as JSON, the URLs of the modules that loaded with it: node loaded-modules.mjs <entry>
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const [entry] = process.argv.slice(2);
const loaded = [];
registerHooks({
  load(url, context, nextLoad) {
    loaded.push(url);
    return nextLoad(url, context);
  },
});

await import(pathToFileURL(entry).href);
process.stdout.write(JSON.stringify(loaded));
