// Loads @frontmcp/sdk and one of its subpaths from the project this file is copied into, with require() or import(), and
// prints, as JSON, the subpath's export names and those not the root's: node subpath-exports.mjs <subpath> <require|import>
import { createRequire } from 'node:module';

const [subpath, loader] = process.argv.slice(2);
const load = loader === 'require' ? createRequire(import.meta.url) : (specifier) => import(specifier);
const root = await load('@frontmcp/sdk');
const subpathExports = await load(`@frontmcp/sdk/${subpath}`);

const names = Object.keys(subpathExports).sort();
const notFromRoot = names.filter((name) => subpathExports[name] === undefined || subpathExports[name] !== root[name]);
process.stdout.write(JSON.stringify({ names, notFromRoot }));
