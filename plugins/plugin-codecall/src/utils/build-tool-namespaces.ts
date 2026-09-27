// file: libs/plugins/src/codecall/utils/build-tool-namespaces.ts

/**
 * Identifier pattern matching valid JavaScript identifiers. Used to guard
 * against tool names that would produce illegal property accessors in
 * AgentScript (e.g. `acme.get-user`).
 */
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Property names that reach a JavaScript prototype rather than the object in
 * hand (GHSA-cmrw-xhcg-6gf9).
 *
 * These all satisfy `IDENT_RE` — `_` is a legal leading character — so the
 * identifier check alone lets them through. The danger is in the READ: for
 * `__proto__`, `namespaces['__proto__']` hits the inherited getter and returns
 * `Object.prototype`, which is truthy, so a `??` fallback short-circuits and the
 * subsequent method assignment lands on the intrinsic itself. `constructor`
 * behaves the same way against the `Object` constructor.
 */
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Namespaces that would shadow agentscript globals or commonly-relied-upon
 * intrinsics. Tools whose prefix matches one of these are not surfaced as a
 * namespace; they remain reachable via `callTool('<full-name>', ...)`.
 */
const RESERVED_NAMESPACES: ReadonlySet<string> = new Set([
  'console',
  'Math',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Promise',
  'Symbol',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Date',
  'Error',
  'RegExp',
  'globalThis',
  'global',
  'window',
  'self',
  'undefined',
  'null',
  'true',
  'false',
  'callTool',
  'getTool',
  'mcpLog',
  'mcpNotify',
]);

/**
 * Minimal shape needed from a registered tool to drive namespace generation.
 * Accepts either the registry's `ToolEntry` or any object exposing `name`.
 */
export interface NamespaceableTool {
  readonly name: string;
}

/** A single namespace: method name → the full tool name it calls (`{ getUser: 'acme.getUser' }`). */
export type ToolNamespace = Record<string, string>;

/** The full namespace map (e.g. `{ acme: { getUser: 'acme.getUser' }, billing: { ... } }`). */
export type ToolNamespaces = Record<string, ToolNamespace>;

/**
 * Reasons a tool may be skipped during namespace generation. Returned so the
 * caller can surface diagnostics without re-deriving the rules.
 */
export type NamespaceSkipReason =
  | 'no-namespace-prefix' // tool name has no `.`
  | 'invalid-identifier' // prefix or suffix is not a JS identifier
  | 'reserved-namespace' // prefix shadows a global / intrinsic, or is a word AgentScript refuses
  | 'prototype-key' // prefix or suffix would reach a JavaScript prototype
  | 'duplicate-method'; // another tool already mapped to the same {ns}.{method}

export interface BuildToolNamespacesResult {
  /** The namespaces a script may use, as plain data. Render them with `wrapScriptWithToolNamespaces`. */
  namespaces: ToolNamespaces;
  /** Tools that were skipped, with the reason. Useful for logs / lint output. */
  skipped: Array<{ name: string; reason: NamespaceSkipReason }>;
}

/**
 * Words a namespace cannot be bound to inside the sandbox: JavaScript reserved words (a
 * `const` of one is a syntax error), AgentScript's own globals (a binding would shadow
 * them for the script), and identifiers the AgentScript validator refuses anywhere (a
 * binding would make every script that uses the namespace fail validation).
 */
const UNBINDABLE_NAMESPACES: ReadonlySet<string> = new Set(
  [
    // Reserved words and strict-mode restricted bindings
    'break case catch class const continue debugger default delete do else enum export extends finally for',
    'function if import in instanceof new return super switch this throw try typeof var void while with yield',
    'let static implements interface package private protected public await eval arguments NaN Infinity',
    // AgentScript globals
    'parallel isNaN isFinite parseInt parseFloat encodeURI encodeURIComponent decodeURI decodeURIComponent',
    // Identifiers the AgentScript validator refuses
    'process require module exports Buffer Function AsyncFunction GeneratorFunction Reflect Proxy TypeError',
    'ReferenceError SyntaxError RangeError URIError EvalError AggregateError fetch XMLHttpRequest WebSocket',
    'localStorage sessionStorage indexedDB crypto performance structuredClone AbortController AbortSignal',
    'MessageChannel MessagePort BroadcastChannel TextEncoder TextDecoder Intl setTimeout setInterval',
    'setImmediate clearTimeout clearInterval clearImmediate queueMicrotask WebAssembly Worker SharedWorker',
    'ServiceWorker WeakRef FinalizationRegistry BigInt Atomics SharedArrayBuffer ArrayBuffer DataView',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Build the namespace map from dotted tool names so AgentScript can call
 * `await acme.getUser({...})` instead of `await callTool('acme.getUser', {...})`.
 *
 * - Tools whose name has no `.` are skipped (still callable via `callTool`).
 * - Tools whose prefix or suffix is not a valid JS identifier are skipped.
 * - Tools whose prefix collides with a reserved global or word are skipped.
 * - Tools whose prefix or suffix is a prototype key (`__proto__`, `constructor`,
 *   `prototype`) are skipped.
 * - First registration wins on duplicate `{ns}.{method}` (subsequent are reported as skipped).
 *
 * The result is plain data (method → tool name). The namespace functions themselves are
 * written in AgentScript by `wrapScriptWithToolNamespaces`, so every call they make is a
 * `callTool()` inside the sandbox and goes through the sandbox's tool-call cap, rate limit
 * and suspicious-sequence checks, exactly like a direct `callTool()`.
 */
export function buildToolNamespaces(tools: ReadonlyArray<NamespaceableTool>): BuildToolNamespacesResult {
  // Null-prototype maps: with no prototype chain, an unsafe key that ever slips
  // past the checks above still cannot reach a JavaScript intrinsic.
  const namespaces: ToolNamespaces = Object.create(null) as ToolNamespaces;
  const skipped: BuildToolNamespacesResult['skipped'] = [];

  for (const tool of tools) {
    const name = tool?.name;
    if (typeof name !== 'string' || name.length === 0) continue;

    const dot = name.indexOf('.');
    if (dot <= 0 || dot === name.length - 1) {
      skipped.push({ name, reason: 'no-namespace-prefix' });
      continue;
    }

    const ns = name.slice(0, dot);
    const method = name.slice(dot + 1);

    if (!IDENT_RE.test(ns) || !IDENT_RE.test(method)) {
      skipped.push({ name, reason: 'invalid-identifier' });
      continue;
    }

    if (PROTOTYPE_KEYS.has(ns) || PROTOTYPE_KEYS.has(method)) {
      // Rejected explicitly, so a hostile name is visible in `skipped` instead of silently
      // vanishing. Must `continue`, never throw: the caller treats namespace building as
      // best-effort. A prototype key in the METHOD half is refused too: an object-literal
      // `"__proto__"` key sets the prototype, and AgentScript refuses `.constructor` /
      // `.prototype` access anyway, so such a method could never be called.
      skipped.push({ name, reason: 'prototype-key' });
      continue;
    }

    if (RESERVED_NAMESPACES.has(ns) || UNBINDABLE_NAMESPACES.has(ns) || ns.startsWith('__')) {
      skipped.push({ name, reason: 'reserved-namespace' });
      continue;
    }

    const bucket = namespaces[ns] ?? (namespaces[ns] = Object.create(null) as ToolNamespace);
    if (Object.prototype.hasOwnProperty.call(bucket, method)) {
      skipped.push({ name, reason: 'duplicate-method' });
      continue;
    }

    bucket[method] = name;
  }

  return { namespaces, skipped };
}

/** The AgentScript helper every namespace method goes through (keeps `{ throwOnError: false }`). */
const NAMESPACE_CALL_HELPER = '__codecallNamespaceCall';

const NAMESPACE_CALL_HELPER_SOURCE =
  `const ${NAMESPACE_CALL_HELPER} = async (toolName, run, options) => { ` +
  `if (options && options.throwOnError === false) { ` +
  `try { return { success: true, data: await run() }; } ` +
  `catch (error) { return { success: false, error: { message: error && error.message, toolName: toolName } }; } } ` +
  `return await run(); };`;

/**
 * Whether `script` may reference `identifier`: a whole word that is not a property name
 * (`x.mail`) and does not start a string (`'mail.list'`). Over-inclusive on purpose: a false
 * positive only adds an unused declaration, a false negative would leave a name undeclared.
 */
function mentionsIdentifier(script: string, identifier: string): boolean {
  let from = 0;
  for (;;) {
    const at = script.indexOf(identifier, from);
    if (at === -1) return false;
    from = at + 1;
    const before = at > 0 ? script[at - 1] : '';
    const after = script[at + identifier.length] ?? '';
    if (/[A-Za-z0-9_$'"`]/.test(before) || /[A-Za-z0-9_$]/.test(after)) continue;
    // `x.mail` is a property, but `...mail` spreads the namespace.
    if (before === '.' && script.slice(Math.max(0, at - 3), at) !== '...') continue;
    return true;
  }
}

/**
 * Make the namespaces available to `script`, as AgentScript.
 *
 * Each namespace becomes a `const` object whose methods call `callTool('<ns>.<method>', input)`
 * inside the sandbox, so the enclave counts, rate-limits and pattern-checks them like any
 * other `callTool()`. (1.8.2 injected them as host functions, which reached the tool
 * pipeline without passing any of those checks.) The user's script runs in a nested async
 * function, so it can still declare its own variables with the same names.
 *
 * Only namespaces the script mentions are emitted; a script that uses none is returned as is.
 * Everything is emitted on the script's first line, so line numbers in parse errors are kept.
 */
export function wrapScriptWithToolNamespaces(script: string, namespaces: ToolNamespaces | undefined): string {
  if (!namespaces) return script;
  const declarations: string[] = [];
  for (const ns of Object.keys(namespaces)) {
    // Re-check what `buildToolNamespaces` guarantees: these strings become source code.
    if (!IDENT_RE.test(ns) || RESERVED_NAMESPACES.has(ns) || UNBINDABLE_NAMESPACES.has(ns) || ns.startsWith('__')) {
      continue;
    }
    if (PROTOTYPE_KEYS.has(ns) || !mentionsIdentifier(script, ns)) continue;
    const methods = namespaces[ns];
    const entries: string[] = [];
    for (const method of Object.keys(methods)) {
      const toolName = methods[method];
      if (!IDENT_RE.test(method) || PROTOTYPE_KEYS.has(method) || toolName !== `${ns}.${method}`) continue;
      const literal = JSON.stringify(toolName);
      entries.push(
        `${JSON.stringify(method)}: (input, options) => ${NAMESPACE_CALL_HELPER}(${literal}, ` +
          `() => callTool(${literal}, input === undefined ? {} : input), options)`,
      );
    }
    if (entries.length > 0) {
      declarations.push(`const ${ns} = { ${entries.join(', ')} };`);
    }
  }
  if (declarations.length === 0) return script;
  return `${NAMESPACE_CALL_HELPER_SOURCE} ${declarations.join(' ')} return await (async () => {${script}\n})();`;
}
