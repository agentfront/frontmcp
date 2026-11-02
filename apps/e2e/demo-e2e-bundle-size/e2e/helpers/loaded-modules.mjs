// Imports a module and prints, as JSON, the URLs of the modules that loaded with it and match a pattern: node loaded-modules.mjs <entry> <pattern>
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const [entry, pattern] = process.argv.slice(2);
const matching = new RegExp(pattern);
const loaded = [];
registerHooks({
  load(url, context, nextLoad) {
    if (matching.test(url)) loaded.push(url);
    return nextLoad(url, context);
  },
});

await import(pathToFileURL(entry).href);
process.stdout.write(JSON.stringify(loaded));
