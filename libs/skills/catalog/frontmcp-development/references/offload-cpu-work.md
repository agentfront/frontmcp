---
name: offload-cpu-work
description: Run CPU-heavy work in a worker-thread pool with this.offload() and @Resource({ worker true }), so the server keeps answering
---

# Offloading CPU-Heavy Work to Worker Threads

A FrontMCP server answers every request on one event loop. A tool or a resource that parses a large file, walks a
repository or computes for seconds blocks that loop, and every other call, `ping` included, waits for it. FrontMCP runs
such work in a pool of `worker_threads` instead:

- `this.offload(moduleRef, args, { budgetMs })` on any execution context (tools, resources, prompts, agents, jobs) runs
  an exported function of another module in a worker and resolves with its result.
- `@Resource({ worker: true })` (and `@ResourceTemplate`, `resource()`, `resourceTemplate()`) runs the resource's whole
  read in a worker.
- `@Job({ runner: 'worker' })` (or `jobs.runner: 'worker'`) runs a job's whole `execute()` in a worker, under the same
  rules as a worker resource (see `create-job`).

All three are Node only. The pool starts its first worker on the first call that needs one, and shuts down with the server.

## When to Use This Skill

### Must Use

- A tool or resource keeps the CPU busy for more than a few tens of milliseconds (parsing, hashing, diffing, indexing)
- Clients see `ping`s or other calls stall while one heavy call runs

### Recommended

- Bounding work that can run away (a pathological input, a regex on untrusted text) with a budget that stops it
- Work that must stop when the client cancels: the call's `this.signal` terminates the worker

### Skip When

- The work waits on I/O (HTTP, a database): it already leaves the event loop free; use `this.fetch()` or the driver
- The server runs on an edge runtime (Cloudflare Workers, Vercel Edge) or in a browser: there are no worker threads,
  and `offload()` throws `OffloadUnsupportedRuntimeError` naming the runtime
- The work needs DI providers, the session or the caller's credentials inside it: read them first and pass the data

> **Decision:** Offload pure, CPU-bound functions of their arguments. Keep I/O and anything that needs the server's
> state on the main thread.

## `this.offload()`

Put the work in its own module and export it as a function. The worker imports that module, so keep it free of side
effects (no server start, no connections opened at import):

```typescript
// src/work/count-words.ts
export function countWords(text: string, minLength: number): number {
  return text.split(/\s+/).filter((word) => word.length >= minLength).length;
}
```

```typescript
// src/tools/count-words.tool.ts
import { join } from 'node:path';

import { Tool, ToolContext, z } from '@frontmcp/sdk';

import type { countWords } from '../work/count-words';

@Tool({ name: 'count_words', inputSchema: { text: z.string(), minLength: z.number().int().default(1) } })
export class CountWordsTool extends ToolContext {
  async execute({ text, minLength }: { text: string; minLength: number }) {
    const words = await this.offload<typeof countWords>(
      { module: join(__dirname, '../work/count-words.js'), export: 'countWords' },
      [text, minLength],
      { budgetMs: 5_000 },
    );
    return { words };
  }
}
```

- **`moduleRef.module`** is an absolute path or a `file:` URL: `new URL('../work/count-words.js', import.meta.url)` in an
  ES module, `join(__dirname, ...)` in CommonJS. A relative path or a package name is refused with
  `InvalidOffloadCallError`.
- **`moduleRef.export`** names the exported function (default `'default'`). A CommonJS module's `module.exports.fn` and
  a TypeScript `export default` compiled to CommonJS are both found.
- **`args`** is the array of arguments. The type parameter (`typeof countWords`) types it and the result; without it
  both are `unknown`.
- **`options.budgetMs`** (default `offload.budgetMs`, 30000) bounds how long the function may run once it starts in its
  worker. Past it the worker is terminated, the call rejects with `OffloadBudgetExceededError` (`OFFLOAD_BUDGET_EXCEEDED`)
  and the server logs a warning, once per offloaded function (later overruns are logged at verbose level). Waiting for a
  free worker does not count; loading the module in a fresh worker is bounded by the larger of this and
  `offload.budgetMs`.
- **`options.signal`** (default `this.signal`) stops the work: the worker is terminated and the call rejects with
  `OffloadAbortedError` (`OFFLOAD_ABORTED`). A tool's `this.signal` aborts when the client cancels and when the tool's
  `timeout` passes, so a timed-out tool does not leave its worker running.

In development (`frontmcp dev`, which runs `tsx`), a worker loads `.ts` modules too: it registers tsx itself, since tsx
hooks only the main thread (a tsx without the `tsx/cjs/api` and `tsx/esm/api` entry points is skipped, and the worker
then loads JavaScript modules only). A production build must ship the module as its own file next to the code that names
it; `frontmcp build --target node` bundles the server into one file, so keep offloaded modules out of the bundle (copy
them with the build output) and point `moduleRef.module` at the copied file.

## `@Resource({ worker: true })`

```typescript
import { readFileSync } from 'node:fs';

import { Resource, ResourceContext } from '@frontmcp/sdk';

import { buildIndex } from '../work/build-index';

@Resource({ name: 'repo-index', uri: 'repo://index', mimeType: 'application/json', worker: { budgetMs: 10_000 } })
export class RepoIndexResource extends ResourceContext {
  async execute(uri: string) {
    this.logger.info(`indexing for ${uri}`);
    return buildIndex(readFileSync('/srv/repo/manifest.json', 'utf8'));
  }
}
```

`worker` is `true` or `{ budgetMs }` (default `offload.budgetMs`). The read-resource flow runs as usual (authorities,
`enabled`, hooks, output validation and the answer budget all run on the main thread); only `execute()` runs in a
worker. FrontMCP records the module the decorator was evaluated in (a module of an installed package too), the worker
imports that module (its `@FrontMcp` class, if it has one, serves nothing there), builds the resource and calls
`execute(uri, params)`. Keep worker resources in their own module with no import-time side effects.

The `--target node` build keeps `@frontmcp/sdk` out of the server bundle, so a worker imports that bundle. A bundle that
inlines the SDK (a SEA binary, `mcpb`, `lambda`, `vercel`) has no separate module to import: its `worker` reads are
refused with `InvalidOffloadCallError`.

What the worker-side resource can and can't reach:

| Available in the worker                                           | Not available                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `uri`, `params`, `this.metadata`                                  | `this.get()` throws `ProviderNotAvailableError`; `this.tryGet()` returns `undefined` |
| `this.respond(value)`, `this.fail(error)`                         | `this.scope`, `this.auth` and `this.context` throw (no scope or request context)     |
| `this.logger` (its lines are written by the server's logger)      | `this.offload()` rejects (no pool inside a worker)                                   |
| `this.fetch()` as a plain `fetch` (no forwarded headers or token) | `this.signal` is undefined (cancelling the read terminates the worker)               |

The output crosses back by structured clone, so return plain data: strings, numbers, arrays, plain objects, `Date`,
`Map`, `Set`, typed arrays. An error thrown in the worker reaches the flow with its name, message, stack and `code`. A
public FrontMCP error (`ResourceNotFoundError`, `refused(...)`) stays public, with its JSON-RPC code, data and remedy,
so the client gets the answer an inline read gives (`-32002` and `data.uri` for a missing resource). Any other error is
internal, as it is on the main thread, even one that has an `isPublic` property.

## What Crosses the Worker Boundary

A worker never receives what it was not passed:

- **In:** the module URL, the export name (or the resource's name, URI and parameters) and `args`, by structured clone.
  Its `process.env` holds only the variables named in `offload.env` (default `['NODE_ENV']`); variables the server
  loaded from `--env-file` are removed too. No DI container, session, auth info, access token or request headers.
- **Flags:** a worker inherits the server's `execArgv` (loaders, conditions), never its arguments. A preload among them
  (`--require`, `--import`) runs in each worker before the worker clears its environment, and an `--env-file` flag is
  read again there, so a preload must not keep the variables it sees.
- **Out:** the return value by structured clone; an error's name, message, stack, `code`, whether it is public and, for
  a public FrontMCP error, its JSON-RPC code, data and remedy; a worker-side resource's log lines.
- A worker's `console.log` goes to the server's stderr, so it never corrupts a stdio transport.

## The `offload` Server Option

```typescript
@FrontMcp({
  info: { name: 'repo-tools', version: '1.0.0' },
  apps: [RepoApp],
  offload: { maxWorkers: 2, idleTimeoutMs: 60_000, budgetMs: 20_000, env: ['NODE_ENV', 'TZ'] },
})
export default class Server {}
```

| Option          | Default                                          | Meaning                                              |
| --------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `maxWorkers`    | available parallelism minus one, between 1 and 4 | Workers per scope; calls past it wait for a free one |
| `idleTimeoutMs` | `30000`                                          | An idle worker is stopped after this long            |
| `budgetMs`      | `30000`                                          | Budget of a call that gives none                     |
| `env`           | `['NODE_ENV']`                                   | Environment variables copied into each worker        |

Each option is validated at startup: an invalid one fails `@FrontMcp` with `InvalidDecoratorMetadataError` naming it
(`offload.maxWorkers must be at least 1`, `offload.budgetMs must be a whole number of milliseconds`). Each scope (a
`splitByApp` app has its own) has its own pool, so a server of N split apps runs up to N × `maxWorkers` worker threads.
The pool shuts down when its scope is disposed (graceful HTTP or stdio shutdown, `dispose()` of
`create()`/`createDirect()`, the last `connect()` client's `close()`): workers are terminated and the calls still
running or waiting reject with `OffloadAbortedError`.

## Errors

| Error                            | Code                          | When                                                                             |
| -------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `OffloadBudgetExceededError`     | `OFFLOAD_BUDGET_EXCEEDED`     | The function ran past its budget; public, `budgetMs` and `target`                |
| `OffloadAbortedError`            | `OFFLOAD_ABORTED`             | The signal aborted, or the server shut down                                      |
| `OffloadNotCloneableError`       | `OFFLOAD_NOT_CLONEABLE`       | An argument or the result is a function, a symbol or another non-cloneable value |
| `OffloadWorkerError`             | `OFFLOAD_WORKER_FAILED`       | The worker crashed (an uncaught error, `process.exit()`, out of memory)          |
| `OffloadUnsupportedRuntimeError` | `OFFLOAD_UNSUPPORTED_RUNTIME` | Not Node.js; `runtime` names the one it is                                       |
| `InvalidOffloadCallError`        | `INVALID_OFFLOAD_CALL`        | A relative path, a non-`file:` URL, no such export, non-array `args`             |

## Common Patterns

| Pattern                 | Correct                                                                   | Incorrect                                                      | Why                                                     |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| Module path             | `join(__dirname, 'parse.js')` or `new URL('./parse.js', import.meta.url)` | `'./parse.js'`                                                 | A worker has no notion of the caller's directory        |
| Data a worker needs     | `this.offload(ref, [await this.get(Repo).manifest()])`                    | `this.get(Repo)` inside the offloaded function                 | There is no DI container in a worker                    |
| Results                 | Plain objects, arrays, strings                                            | Class instances with methods, functions                        | Structured clone drops prototypes and refuses functions |
| Worker resource modules | One resource (and its helpers) per module                                 | The `@FrontMcp` server file declaring `worker: true` resources | The worker imports the whole module                     |

## Verification Checklist

- [ ] The offloaded function is exported from a module with no import-time side effects
- [ ] `moduleRef.module` is absolute (or a `file:` URL), and the file ships with the build
- [ ] Arguments and results are plain, cloneable data
- [ ] A `budgetMs` bounds work that can run away, and the tool passes no signal other than `this.signal`
- [ ] A `worker: true` resource uses no `this.get()`, `this.scope`, `this.auth` or `this.context` in `execute()`
- [ ] `offload.env` names every environment variable the offloaded code reads, and no secret it does not need

## Troubleshooting

| Problem                                            | Cause                                                          | Solution                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `has no exported function "x"`                     | The export name is wrong, or the module exports something else | Check `moduleRef.export`; a default export needs no `export`                              |
| `Importing ... registered no worker resource`      | The resource class is not in the module the decorator ran in   | Declare the resource directly in its module (not through a factory in another file)       |
| `the module that declares it was not found`        | The server is a bundle that inlines `@frontmcp/sdk`            | Build with `--target node`, or offload the computation with `this.offload()` instead      |
| `Provider "X" is not available: ... worker thread` | A `worker: true` resource calls `this.get(X)`                  | Drop `worker`, or move the DI-dependent part into a tool and offload only the computation |
| Calls past `maxWorkers` are slow                   | They wait for a free worker                                    | Raise `offload.maxWorkers`, or lower the work per call                                    |
| `process.env.X` is undefined in the worker         | Only `offload.env` crosses                                     | Add `X` to `offload.env`, or pass the value in `args`                                     |
| `OffloadUnsupportedRuntimeError`                   | The server runs on an edge runtime or in a browser             | Run the work on a Node.js server, or keep it inline                                       |

## Reference

- [Resources](https://frontmcp.dev/reference/sdk/resource) · [Tools](https://frontmcp.dev/reference/sdk/tool) · [`@FrontMcp` configuration](https://frontmcp.dev/reference/sdk/front-mcp)
- Related skills: `create-resource`, [`create-tool`](../../create-tool/SKILL.md), `create-provider`
