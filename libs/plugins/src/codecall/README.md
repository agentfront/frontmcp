# CodeCall Plugin (internal docs)

This document is for **contributors** working on the CodeCall plugin implementation.

For user-facing docs, see the **CodeCall** page in the main FrontMCP documentation (Mintlify).

---

## Overview

**CodeCall** replaces direct MCP tool calls with **code calls**:

- The LLM no longer calls each tool directly.
- Instead, it interacts with a small meta-API:
  - `codecall.search`
  - `codecall.describe`
  - `codecall.execute`
  - (optional) `codecall.invoke` for direct calls without a VM
- The LLM writes **JavaScript execution plans** that run inside a `vm2` sandbox and call real tools through well-defined globals.

Goals:

- Support **dozens or hundreds of tools** (inline + adapters like OpenAPI) without flooding `list_tools`.
- Let the LLM perform:
  - Multi-step workflows.
  - Cross-tool joins and aggregations.
  - Post-processing and custom filtering.
- Enforce safety with:
  - AST validation.
  - CSP-style VM presets.
  - Strict sandboxing (no FS / network / Node builtins).
- Work across **multiple apps** in the same FrontMCP server, with filtering by `appId`.
- Preserve **PII/privacy guarantees** by always going through the normal tool pipeline and plugins.

---

## High-level architecture

1. **Tool indexing**
   - On app/bootstrap, the plugin receives the resolved list of tools (inline + adapters) across all apps.
   - It builds an index containing:
     - `name`
     - `description`
     - `source` (e.g. `inline`, `openapi`)
     - `appId`
     - input schema (`inputSchema`)
     - optional output schema (`outputSchema`)
   - An optional `includeTools` predicate can drop tools from the index entirely.

2. **Modes + metadata**
   - CodeCall has a `mode` that controls:
     - Which tools appear in `list_tools`.
     - Which tools are indexed and callable by CodeCall.
   - Tools are annotated with `codecall` metadata via the `@Tool` decorator.

3. **Multi-app / filter-aware search**
   - `codecall.search` accepts a `filter` object that can include:
     - `appIds` – limit search to one or more apps (e.g. `['user', 'billing']`).
     - Other tags or flags.
   - The LLM can:
     - Search in a single app (e.g. only `user` tools).
     - Search in multiple apps (e.g. join `user` + `billing`).
     - Or omit `appIds` to search across all apps.

4. **`list_tools` interception**
   - CodeCall intercepts tool listing and replaces it with:
     - `codecall.search`
     - `codecall.describe`
     - `codecall.execute`
     - (optionally) `codecall.invoke`
     - plus any tools whose metadata requires them to stay visible.

5. **Search / describe**
   - `codecall.search`:
     - Scores tools against a natural-language query (optionally scoped by `filter`).
     - Returns the top `topK`.
   - `codecall.describe`:
     - Returns JSON-schema-like shapes for selected tools so the LLM can generate valid JS code.

6. **Plan execution**
   - `codecall.execute`:
     - Parses the script into an AST.
     - Validates the AST against security rules (no banned builtins/globals, optional loop ban).
     - Applies a CSP-style VM preset + overrides.
     - Spawns a `vm2` sandbox with:
       - `callTool`
       - `getTool`
       - `codecallContext`
       - optional `console`
       - optional `mcpLog` / `mcpNotify`
     - Executes with a timeout.
     - Sends MCP notifications for **each tool call start/end**.
     - Returns a normalized result with a `status` discriminant.

7. **Direct calls (no VM)**
   - If enabled, CodeCall exposes `codecall.invoke`:
     - Calls tools directly via the underlying tool pipeline (no VM, no JS plan).
     - Still uses the same plugin chain, PII behavior, and error model.

8. **Sessions & tool list notifications**
   - If the transport supports **tool list change notifications** and **transport session IDs**:
     - Clients can cache tool descriptions per session.
     - CodeCall can emit “tool list changed” events when relevant tools change.
   - If not supported:
     - Orchestrators should re-run `codecall.describe` before `codecall.execute` when they rely on fresh schemas.

---

## PII, privacy, and plugin chaining

CodeCall **does not bypass** the normal FrontMCP tool lifecycle.

Internally, `callTool(name, input)` inside the VM must delegate to the same
**tool call pipeline** used by direct MCP tool calls. That means:

- Any existing plugins that hook into **tool call lifecycle** (e.g. PII scrubbing,
  masking, audit logging, rate limiting, auth) will still run as usual.
- CodeCall does not introduce extra data paths:
  - The data seen by the VM is exactly what a normal tool call would see
    *after* all relevant plugins have run.
  - The result that CodeCall returns is equivalent to calling the same tools
    one-by-one outside of CodeCall.

For PII specifically:

- A PII plugin can hook:
  - **Before** tool execution to scrub/mask sensitive fields in the input.
  - **After** tool execution to scrub/mask sensitive data in the output.
- CodeCall’s `callTool` simply calls into the underlying tool call engine.
- Therefore:
  - CodeCall cannot “leak” data that the PII plugin wouldn’t already allow.
  - Any PII redaction/obfuscation logic stays fully in control of the PII plugin.

In other words: CodeCall **reuses** the same tool pipeline; it does not create a new backdoor.

---

## Tool metadata extension

CodeCall extends `@Tool` options by adding a `codecall` section via `declare global`.

Conceptual shape:

```ts
declare global {
  interface ToolOptions {
    codecall?: {
      /**
       * If true, this tool stays visible in list_tools alongside the
       * CodeCall meta-tools, depending on mode.
       */
      visibleInListTools?: boolean;

      /**
       * Enable/disable this tool for CodeCall search/execute.
       *
       * Defaults depend on CodeCall mode:
       *  - 'codecall_only': default true
       *  - 'codecall_opt_in': default false
       *  - 'metadata_driven': default false (must be explicit)
       */
      enabledInCodeCall?: boolean;
    };
  }
}
````

Example tool:

```ts
@Tool({
  name: 'users:list',
  description: 'List users with pagination',
  codecall: {
    enabledInCodeCall: true,
    visibleInListTools: false,
  },
})
export class ListUsersTool {
  // ...
}
```

Implementation detail: ship a `.d.ts` or `types` entry that adds this `codecall` field globally when the package is imported.

---

## Modes

### Type

```ts
export type CodeCallMode =
  | 'codecall_only'
  | 'codecall_opt_in'
  | 'metadata_driven';
```

### Semantics & best practices

#### `codecall_only` (recommended default)

**Use when:**

* There are **many tools** (dozens/hundreds).
* You want them **all available via CodeCall**, but **not all listed** in `list_tools`.

**Behavior:**

* `list_tools`:

    * Hide all tools by default.
    * Show tools with `codecall.visibleInListTools === true`.
* CodeCall index:

    * Include all tools by default.
    * Exclude tools if:

        * `includeTools(tool) === false`, or
        * `codecall.enabledInCodeCall === false`.

#### `codecall_opt_in`

**Use when:**

* There is a large toolset but only a **specific subset** should be used via CodeCall.
* You don’t want all tools in the “code surface”.

**Behavior:**

* `list_tools`:

    * Hide all tools by default.
    * Show tools with `codecall.visibleInListTools === true`.
* CodeCall index:

    * Include **only** tools with `codecall.enabledInCodeCall === true`.

#### `metadata_driven`

**Use when:**

* There are **few tools** (≈ up to 10).
* You want to combine **classic tool calls + CodeCall** on the same tools.
* The user is comfortable configuring everything via metadata.

**Behavior:**

* `list_tools`:

    * Show tools with `codecall.visibleInListTools === true`.
* CodeCall index:

    * Include tools with `codecall.enabledInCodeCall === true`.
* No other implicit defaults.

---

## Plugin options

```ts
export interface CodeCallOptions {
  /**
   * How CodeCall hides/shows tools and includes them in the CodeCall index.
   *
   * - 'codecall_only' (default):
   *     Many tools, want them ALL available via CodeCall, but NOT all listed.
   *
   * - 'codecall_opt_in':
   *     Many tools, only SOME should be available via CodeCall (opt-in).
   *
   * - 'metadata_driven':
   *     Few tools (up to ~10), want to mix normal tool calls + CodeCall
   *     and control everything via metadata.
   */
  mode?: CodeCallMode;

  /**
   * Default number of tools returned from `codecall.search`.
   * @default 8
   */
  topK?: number;

  /**
   * Maximum number of tool definitions returned from `codecall.describe`.
   * @default 8
   */
  maxDefinitions?: number;

  /**
   * Optional filter deciding which tools are even *seen* by CodeCall
   * before applying mode/metadata rules. Useful to drop entire groups.
   */
  includeTools?: (tool: {
    name: string;
    appId?: string;
    source?: string;
    description?: string;
    tags?: string[];
  }) => boolean;

  /**
   * Optional "direct call" mode: allow the LLM to call tools through CodeCall
   * **without** writing JavaScript or running a VM.
   *
   * Exposed via the `codecall.invoke` meta-tool.
   */
  directCalls?: {
    /**
     * Enable or disable direct tool calls via CodeCall.
     * @default false
     */
    enabled: boolean;

    /**
     * Optional allowlist of tool names that can be called directly.
     * If omitted, a reasonable default is "any tool that is enabledInCodeCall".
     */
    allowedTools?: string[];

    /**
     * Optional filter for more advanced policies (e.g. based on appId/tags).
     */
    filter?: (tool: {
      name: string;
      appId?: string;
      source?: string;
      tags?: string[];
    }) => boolean;
  };

  /**
   * vm2 sandbox configuration and CSP-style policy.
   */
  vm?: {
    /**
     * CSP-like VM preset ('locked_down', 'secure', 'balanced', 'experimental').
     * @default 'secure'
     */
    preset?: CodeCallVmPreset;

    timeoutMs?: number;
    allowLoops?: boolean;
    maxSteps?: number;
    disabledBuiltins?: string[];
    disabledGlobals?: string[];
    allowConsole?: boolean;
  };
}
```

Default `mode` should be `'codecall_only'`.

`includeTools` is applied *before* mode/metadata rules to drop tools entirely from CodeCall.

---

## VM presets and security

### Preset type

```ts
export type CodeCallVmPreset =
  | 'locked_down'
  | 'secure'
  | 'balanced'
  | 'experimental';
```

### Expected behavior (intent)

#### `locked_down`

* Very strict, for sensitive deployments.
* Short `timeoutMs` (~2000).
* `allowLoops: false`.
* `allowConsole: false`.
* Large `disabledBuiltins` and `disabledGlobals` sets.
* Analogy: CSP `default-src 'none'`.

#### `secure` (default)

* Default for untrusted LLM code.
* `timeoutMs` ~3000–4000.
* `allowLoops: false` (forces linear code).
* `allowConsole: true` (logs captured).
* `disabledBuiltins`: at least `['eval', 'Function']`.
* `disabledGlobals`: block Node & network, timers (`['require', 'process', 'fetch', 'setTimeout', 'setInterval']`).

#### `balanced`

* More permissive for trusted/internal usage.
* `allowLoops: true`.
* `allowConsole: true`.
* `disabledBuiltins`: `['eval', 'Function']`.
* `disabledGlobals`: still block Node/network.

#### `experimental`

* For local dev only.
* Higher `timeoutMs`.
* `allowLoops: true`, `allowConsole: true`.
* Minimal blocking (still block `eval`, `Function` at minimum).

### Security pipeline

1. **AST validation**

    * Parse `script` to an AST.
    * Reject:

        * Disallowed identifiers (from `disabledBuiltins` / `disabledGlobals`).
        * Loop nodes (`ForStatement`, `WhileStatement`, `DoWhileStatement`, `ForOfStatement`, `ForInStatement`) if `allowLoops === false`.
    * Happens *before* any VM execution.

2. **VM configuration**

    * Start from preset defaults.
    * Apply `vm` overrides.
    * Construct `vm2` options with:

        * `sandbox` object (`callTool`, `getTool`, `codecallContext`, optional `console`, optional `mcpLog` / `mcpNotify`).
        * No `require` or other Node internals.

3. **Execution**

    * Run script with `vm2` and `timeoutMs`.
    * Map outcomes to `CodeCallExecuteResult`:

        * `ok`
        * `syntax_error`
        * `illegal_access`
        * `tool_error`
        * `runtime_error`
        * `timeout`

---

## Meta-tool contracts

### `codecall.search`

* Input: `CodeCallSearchInput`
* Output: `CodeCallSearchResult`

```ts
export type CodeCallSearchInput = {
  query: string;
  topK?: number;
  filter?: {
    appIds?: string[];
    tags?: string[];
    includeOpenApi?: boolean;
    includeInline?: boolean;
  };
};

export type CodeCallSearchResult = {
  tools: {
    name: string;
    description: string;
    appId?: string;
    source?: string;
    score: number;
  }[];
};
```

Requirements:

* Respect global `topK` default + per-call override.
* Use the tool index after `includeTools` and mode/metadata filtering.
* Respect `filter.appIds` to limit by appId when provided.

---

### `codecall.describe`

* Input: `CodeCallDescribeInput`
* Output: `CodeCallDescribeResult`

```ts
export type CodeCallDescribeInput = {
  tools: string[];
  max?: number;
};

export type CodeCallDescribeResult = {
  tools: {
    name: string;
    description: string;
    inputSchema: unknown;
    outputSchema?: unknown | null;
    examples?: {
      input: unknown;
      output?: unknown;
    }[];
  }[];
};
```

Requirements:

* Only describe tools that are currently in the CodeCall index.
* Respect `maxDefinitions` + per-call override `max`.
* Map internal schemas to JSON-schema-like objects in a stable format.

---

### `codecall.execute`

* Input: `CodeCallExecuteInput`
* Output: `CodeCallExecuteResult`

```ts
export type CodeCallExecuteInput = {
  script: string;
  allowedTools?: string[];
  context?: Record<string, unknown>;
};
```

Inside the VM, injected globals (conceptual):

```ts
declare function callTool<TInput, TResult>(
  name: string,
  input: TInput
): Promise<TResult>;

declare function getTool(name: string): {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown | null;
};

declare const codecallContext: Readonly<Record<string, unknown>>;

declare const console: {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

declare function mcpLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  metadata?: Record<string, unknown>
): void;

declare function mcpNotify(
  event: string,
  payload: Record<string, unknown>
): void;
```

> `console`, `mcpLog`, and `mcpNotify` may be disabled depending on configuration.

Result type:

```ts
export type CodeCallExecuteResult =
  | {
      status: 'ok';
      result: unknown;
      logs?: string[];
    }
  | {
      status: 'syntax_error';
      error: {
        message: string;
        location?: { line: number; column: number };
      };
    }
  | {
      status: 'illegal_access';
      error: {
        message: string;
        kind: 'IllegalBuiltinAccess' | 'DisallowedGlobal' | string;
      };
    }
  | {
      /**
       * Unhandled error thrown by the user script itself
       * (not tied to a specific tool call).
       */
      status: 'runtime_error';
      error: {
        source: 'script';
        message: string;
        name?: string;
        stack?: string;
      };
    }
  | {
      /**
       * Error thrown while calling a specific tool via callTool().
       * Includes tool name + input so the agent/LLM can reason about it.
       */
      status: 'tool_error';
      error: {
        source: 'tool';
        toolName: string;
        toolInput: unknown;
        message: string;
        code?: string;
        details?: unknown;
      };
    }
  | {
      status: 'timeout';
      error: { message: string };
    };
```

### Tool call notifications & error model

#### Automatic notifications for `callTool`

Every `callTool()` invocation should produce MCP notifications so the client/agent can observe:

* **Before** the tool runs:

    * “tool call start” notification:

        * `toolName`
        * `input`
        * `callId` (correlates with end event)

* **After** the tool finishes:

    * “tool call end” notification:

        * `toolName`
        * `input`
        * `callId`
        * `status` (e.g. `"ok"` / `"error"`)
        * optional `durationMs`
        * optional `error` information if it failed

Exact notification shape is defined by the FrontMCP transport, but CodeCall must emit them around each `callTool` execution.

#### Script-driven logging & notifications

CodeCall can expose FrontMCP logging/notification builtins (`mcpLog`, `mcpNotify`) into the VM so the plan itself can decide what to log/notify:

```js
async function main() {
  mcpNotify('step_started', { step: 'load_users' });

  const users = await callTool('users:list', { limit: 100 });

  mcpLog('info', 'Loaded users', { count: users.items.length });

  mcpNotify('step_completed', {
    step: 'load_users',
    count: users.items.length,
  });

  return users.items.map((u) => u.id);
}

return main();
```

These are **thin wrappers** over core logging/notification APIs and must not bypass sandbox constraints.

#### Error separation: script vs tool

* **Script-level errors**:

    * `status: 'runtime_error'`, `error.source: 'script'`
    * Thrown by user code itself (invalid property access, thrown `Error`, etc.).
    * Not tied to a single tool call.
* **Tool-level errors**:

    * `status: 'tool_error'`, `error.source: 'tool'`
    * Thrown while executing a specific `callTool(toolName, input)`.
    * Include:

        * `toolName`
        * `toolInput`
        * `message` (+ optional `code` / `details`).

The LLM can also wrap `callTool` in `try/catch` inside the plan. If it doesn’t, CodeCall surfaces failures as `tool_error` with enough context for retries.

Unknown tool / permission issues should typically surface as:

* `tool_error` with `code: 'UnknownTool'`, or
* A tool-defined “authorization required” payload in `details` (for a future auth plugin to handle).

---

### `codecall.invoke` (direct call, no VM)

If `directCalls.enabled === true`, CodeCall exposes an additional meta-tool such as `codecall.invoke` that allows the LLM to call a tool **without** writing a JavaScript plan.

Type (conceptual):

```ts
export type CodeCallInvokeInput = {
  tool: string;
  input: unknown;
};
```

Behavior:

* Validate that `tool` is allowed by `directCalls` policy.
* Forward the call to the **same tool call pipeline** as normal MCP calls:

    * PII plugin(s)
    * auth / rate limits
    * logging / audit
    * other lifecycle plugins
* No VM is created and no user JS is run.

Output:

* On success:

    * Return tool result (or a wrapped `{ status: 'ok', result }`).
* On error:

    * If tool is unknown/not allowed:

        * Return a clear error referring to `tool`.
    * If the tool throws:

        * Return a `tool_error`-like shape including:

            * `toolName`
            * `toolInput`
            * `message`
            * optional `code` / `details`.

---

## Sessions, caching & tool list notifications

CodeCall should integrate with the surrounding transport protocol:

* With **session IDs + tool list change notifications**:

    * Clients cache search/describe results per session.
    * CodeCall emits notifications when tools relevant to a prior search/describe change.
    * Clients can re-describe only when notified.

* Without notifications:

    * Orchestrators should re-run `codecall.describe` before relying on a tool in `codecall.execute`.

Implementation-specific details (event names, payloads) live in the transport layer, but CodeCall needs hooks to trigger these events.

---

## Dev workflow

Suggested directory:

```text
libs/plugins/src/codecall/
  ├─ index.ts
  ├─ plugin.ts
  ├─ vm/
  │   ├─ presets.ts
  │   ├─ ast-validator.ts
  │   └─ executor.ts
  ├─ types/
  │   └─ codecall.d.ts       # global ToolOptions extension
  ├─ __tests__/
  │   ├─ search.spec.ts
  │   ├─ describe.spec.ts
  │   ├─ execute.spec.ts
  │   ├─ direct-calls.spec.ts
  │   └─ security.spec.ts
  └─ README.md               # this file
```

Typical commands (adapt to repo):

```bash
npx nx test codecall
npx nx lint codecall
```

Testing guidelines:

* **Happy path**:

    * search → describe → execute with valid tools and simple scripts.
* **Error cases**:

    * Script syntax errors.
    * Illegal access (banned globals/builtins).
    * Unknown tool names.
    * Tool-level errors vs script-level errors.
    * Timeout behavior.
* **Mode behavior**:

    * Which tools appear in `list_tools` and search results under each mode.
* **Direct calls**:

    * `codecall.invoke` success + error paths.
* **Security tests**:

    * Attempt access to `process`, `require`, `fetch`, etc.
    * Attempt loops when `allowLoops === false`.
    * Ensure PII plugins still see all inputs/outputs.

---

## Extensibility ideas

Safe extension points:

* Pluggable search strategies (BM25, embeddings).
* More granular tagging/filtering of tools.
* Helper utilities injected as globals (e.g. pagination helpers), guarded by AST + config.
* Per-tenant / per-session VM policies (based on `codecallContext`).
* Future **auth/permissions plugin** that:

    * Detects “authorization required” tool responses.
    * Drives OAuth/permission flows.
    * Retries execution when possible.

Any change that alters the LLM contract (field names, tool names, result shapes) should:

1. Be treated as a breaking change.
2. Update Mintlify docs and this README.
3. Provide migration notes when possible.


