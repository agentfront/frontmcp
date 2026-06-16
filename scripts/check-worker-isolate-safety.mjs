#!/usr/bin/env node
/**
 * frontmcp-worker isolate-safety check (ROADMAP v1.3 #1 — "ensures no Node-only
 * edges regress").
 *
 * V8-isolate runtimes (Cloudflare Workers / workerd) FORBID generating random
 * values, setting timers, or doing async I/O in **global (module-eval) scope** —
 * only inside request handlers. Any code on the worker import graph that calls
 * `randomUUID()` / `randomBytes()` / `setInterval` / `fetch` / … at module top
 * level (or in a module-level IIFE) crashes the Worker at startup.
 *
 * This is a fast, build-free guard: it AST-scans the worker-graph library
 * sources and fails if a module-eval side effect is (re)introduced. It catches
 * regressions in modules that are tree-shaken out of the `demo-e2e-cloudflare`
 * fixture (and so wouldn't surface in the runtime boot e2e). The runtime e2e
 * remains the dynamic proof; this is the static one.
 *
 * Usage: `node scripts/check-worker-isolate-safety.mjs`  (exit 1 on findings)
 */
import { createRequire } from 'module';
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

// Libraries bundled into / reachable from the Cloudflare Worker entry.
const TARGET_DIRS = [
  'libs/edge/src',
  'libs/sdk/src',
  'libs/auth/src',
  'libs/utils/src',
  'libs/protocol/src',
  'libs/adapters/src',
];

// Bare-identifier calls forbidden at module-eval scope on workerd.
const DENY = new Set([
  'randomUUID',
  'randomBytes',
  'randomFillSync',
  'randomInt',
  'getRandomValues',
  'setInterval',
  'setTimeout',
  'setImmediate',
  'fetch',
  'connect',
]);
// Member calls (e.g. `crypto.randomUUID()`, `Math.random()`) by property name.
const DENY_MEMBER = new Set(['random', 'randomUUID', 'randomBytes', 'getRandomValues']);

function walkFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (e !== 'node_modules' && e !== '__tests__') walkFiles(full, out);
    } else if (/\.ts$/.test(e) && !/\.(spec|test|d)\.ts$/.test(e)) {
      out.push(full);
    }
  }
}

// `(() => {…})()` / `(function(){…})()` — runs immediately, so it IS module-eval.
function isIIFE(node) {
  const p = node.parent;
  if (p && ts.isParenthesizedExpression(p) && p.parent && ts.isCallExpression(p.parent) && p.parent.expression === p) {
    return true;
  }
  if (p && ts.isCallExpression(p) && p.expression === node) return true;
  return false;
}

const findings = [];
for (const rel of TARGET_DIRS) {
  const files = [];
  walkFiles(path.join(ROOT, rel), files);
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node, deferred) => {
      // A function/method/accessor/ctor body runs LATER (not at module-eval),
      // unless it is an immediately-invoked function expression.
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessor(node) ||
        ts.isSetAccessor(node) ||
        ts.isConstructorDeclaration(node) ||
        ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !isIIFE(node))
      ) {
        node.forEachChild((c) => visit(c, true));
        return;
      }
      if (!deferred && ts.isCallExpression(node)) {
        const ex = node.expression;
        let name;
        if (ts.isIdentifier(ex)) name = ex.text;
        else if (ts.isPropertyAccessExpression(ex)) name = ex.name.text;
        const hit = name && (DENY.has(name) || (ts.isPropertyAccessExpression(ex) && DENY_MEMBER.has(name)));
        if (hit) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          findings.push(`${path.relative(ROOT, file)}:${line + 1}  ${name}()`);
        }
      }
      node.forEachChild((c) => visit(c, deferred));
    };
    sf.statements.forEach((s) => visit(s, false));
  }
}

if (findings.length === 0) {
  console.log('✓ worker isolate-safety: no module-eval random/timer/network calls in the worker graph.');
  process.exit(0);
}
console.error(`✗ worker isolate-safety: ${findings.length} module-eval side effect(s) would crash a V8 isolate:`);
for (const f of findings) console.error('  ' + f);
console.error(
  '\nMove these out of module/global scope — make them lazy (compute on first use) or run them inside a request handler.',
);
process.exit(1);
