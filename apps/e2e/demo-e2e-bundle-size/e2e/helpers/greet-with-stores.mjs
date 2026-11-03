// Starts a server from a page bundle with these server options and calls its tool; prints the answer, or why startup failed, as JSON: node greet-with-stores.mjs <bundle> <optionsJson>
import { pathToFileURL } from 'node:url';

const [bundle, options] = process.argv.slice(2);
const { greetWith } = await import(pathToFileURL(bundle).href);
try {
  process.stdout.write(JSON.stringify({ result: await greetWith(JSON.parse(options)) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: { name: error.name, code: error.code, message: error.message } }));
}
