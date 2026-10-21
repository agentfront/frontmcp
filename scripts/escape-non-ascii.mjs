// Escapes non-ASCII characters in a build's JavaScript, since one above U+00FF makes V8 keep the whole source at two bytes per character; --check only reports them.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { transformSync } from 'esbuild';

const NON_ASCII = /[\u0080-\uffff]/;
const EACH_NON_ASCII = /[\u0080-\uffff]/g;
const SCRIPT_FILE = /\.(c|m)?js$/;

function scriptFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && SCRIPT_FILE.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function escapeNonAscii(source) {
  return source.replace(EACH_NON_ASCII, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function compiledProgram(source, file) {
  return transformSync(source, { minifyWhitespace: true, legalComments: 'none', charset: 'ascii', sourcefile: file })
    .code;
}

function rewrite(file) {
  const source = readFileSync(file, 'utf8');
  if (!NON_ASCII.test(source)) return false;
  const escaped = escapeNonAscii(source);
  // esbuild keeps regular-expression literals and tagged templates as written, so it can't confirm an escape there.
  if (compiledProgram(escaped, file) !== compiledProgram(source, file)) {
    throw new Error(
      `${file}: escaping its non-ASCII characters may change the program. In a regular-expression literal, write them as \\uXXXX escapes in the source. In a tagged template, an escape changes the raw text the tag reads, so write the template without them (with String.raw, an interpolation such as \${'\\u2014'} keeps the result).`,
    );
  }
  writeFileSync(file, escaped);
  return true;
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const dirs = args.filter((arg) => arg !== '--check');
if (dirs.length === 0) {
  console.error('Usage: node scripts/escape-non-ascii.mjs [--check] <dist-dir> [<dist-dir> ...]');
  process.exit(1);
}
const files = dirs.flatMap(scriptFiles);

if (checkOnly) {
  const offending = files.filter((file) => NON_ASCII.test(readFileSync(file, 'utf8')));
  if (offending.length > 0) {
    console.error(`Non-ASCII characters in ${offending.length} published file(s); run scripts/escape-non-ascii.mjs:`);
    for (const file of offending) console.error(`  ${file}`);
    process.exit(1);
  }
  console.log(`escape-non-ascii: ${files.length} file(s) are ASCII-only.`);
} else {
  const rewritten = files.filter(rewrite);
  console.log(`escape-non-ascii: escaped non-ASCII characters in ${rewritten.length} of ${files.length} file(s).`);
}
