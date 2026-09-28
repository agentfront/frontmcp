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
  | 'unsupported-name' // the sandbox cannot bind it: a method AgentScript refuses, or a tool name it can't carry
  | 'duplicate-method'; // another tool already mapped to the same {ns}.{method}

export interface BuildToolNamespacesResult {
  /** The namespaces a script may use, as plain data (the sandbox's `toolNamespaces`). */
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
    'importScripts ShadowRealm Iterator AsyncIterator',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Property names the AgentScript validator refuses (`mail.fetch` fails validation as
 * `DISALLOWED_IDENTIFIER`), so a method with one could never be called, and the sandbox refuses to
 * bind it. `callTool('mail.fetch', …)` still reaches the tool.
 */
const UNCALLABLE_METHODS: ReadonlySet<string> = new Set(
  [
    'process require module exports Buffer eval Function AsyncFunction GeneratorFunction arguments RegExp',
    'Promise Symbol Proxy Reflect Error TypeError ReferenceError SyntaxError RangeError URIError EvalError',
    'AggregateError fetch XMLHttpRequest WebSocket localStorage sessionStorage indexedDB crypto performance',
    'structuredClone AbortController AbortSignal MessageChannel MessagePort BroadcastChannel TextEncoder',
    'TextDecoder Intl setTimeout setInterval setImmediate clearTimeout clearInterval clearImmediate',
    'queueMicrotask WebAssembly Worker SharedWorker ServiceWorker WeakMap WeakSet WeakRef FinalizationRegistry',
    'Map Set Atomics SharedArrayBuffer importScripts ShadowRealm Iterator AsyncIterator',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Tool names the sandbox can bind to a namespace method: letters, digits, `:`, `.`, `_` and `-`,
 * starting with a letter, at most 256 characters (`@enclave-vm/core` refuses the whole
 * `toolNamespaces` configuration otherwise, which would fail every script).
 */
const SANDBOX_TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9:._-]*$/;
const MAX_SANDBOX_TOOL_NAME_LENGTH = 256;

/** Whether a namespace name can be bound in the sandbox, next to globals named `reservedGlobals`. */
function isBindableNamespace(ns: string, reservedGlobals: ReadonlySet<string>): boolean {
  return (
    IDENT_RE.test(ns) &&
    !PROTOTYPE_KEYS.has(ns) &&
    !ns.startsWith('__') &&
    !RESERVED_NAMESPACES.has(ns) &&
    !UNBINDABLE_NAMESPACES.has(ns) &&
    !reservedGlobals.has(ns)
  );
}

/** Whether `ns.method` can be bound to `toolName` in the sandbox. */
function isBindableMethod(ns: string, method: string, toolName: string): boolean {
  return (
    IDENT_RE.test(method) &&
    !PROTOTYPE_KEYS.has(method) &&
    !method.startsWith('__') &&
    !UNCALLABLE_METHODS.has(method) &&
    toolName === `${ns}.${method}` &&
    toolName.length <= MAX_SANDBOX_TOOL_NAME_LENGTH &&
    SANDBOX_TOOL_NAME_RE.test(toolName)
  );
}

/**
 * Build the namespace map from dotted tool names so AgentScript can call
 * `await acme.getUser({...})` instead of `await callTool('acme.getUser', {...})`.
 *
 * - Tools whose name has no `.` are skipped (still callable via `callTool`).
 * - Tools whose prefix or suffix is not a valid JS identifier are skipped.
 * - Tools whose prefix collides with a reserved global or word are skipped.
 * - Tools whose prefix or suffix is a prototype key (`__proto__`, `constructor`,
 *   `prototype`) are skipped.
 * - Methods AgentScript refuses as property names (`fetch`, `Map`, `__x`), and tool names the
 *   sandbox can't carry (outside letters, digits, `:`, `.`, `_` and `-`, or not starting with a
 *   letter), are skipped.
 * - First registration wins on duplicate `{ns}.{method}` (subsequent are reported as skipped).
 *
 * The result is plain data (method → tool name), handed to the sandbox as its `toolNamespaces`
 * (see `toSandboxToolNamespaces`): the sandbox builds the namespace objects itself, and a method
 * call `ns.method(args, options)` is exactly `callTool('ns.method', args, options)`, with the
 * sandbox's tool-call cap, rate limit, suspicious-sequence checks and `throwOnError` handling.
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

    if (!isBindableMethod(ns, method, name)) {
      skipped.push({ name, reason: 'unsupported-name' });
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

/**
 * The namespaces to hand the sandbox as its `toolNamespaces`: every namespace and method it can
 * bind, next to custom globals named `reservedGlobals` (`getTool`, `mcpLog`, ...). Rechecks what
 * `buildToolNamespaces` guarantees, since the sandbox refuses the whole configuration, and so fails
 * every script, over a single name it can't bind. Returns undefined when nothing is left.
 */
export function toSandboxToolNamespaces(
  namespaces: ToolNamespaces | undefined,
  reservedGlobals: Iterable<string> = [],
): ToolNamespaces | undefined {
  if (!namespaces) return undefined;
  const reserved = new Set(reservedGlobals);
  const bindable: ToolNamespaces = Object.create(null) as ToolNamespaces;
  let count = 0;
  for (const ns of Object.keys(namespaces)) {
    if (!isBindableNamespace(ns, reserved)) continue;
    const methods = namespaces[ns];
    const bucket: ToolNamespace = Object.create(null) as ToolNamespace;
    let methodCount = 0;
    for (const method of Object.keys(methods)) {
      const toolName = methods[method];
      if (typeof toolName !== 'string' || !isBindableMethod(ns, method, toolName)) continue;
      bucket[method] = toolName;
      methodCount += 1;
    }
    if (methodCount > 0) {
      bindable[ns] = bucket;
      count += 1;
    }
  }
  return count > 0 ? bindable : undefined;
}
