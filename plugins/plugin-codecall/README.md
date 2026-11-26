# @frontmcp/plugin-codecall

A FrontMCP plugin for servers with more tools than a model can usefully read. Instead of every tool and its schema,
`tools/list` shows CodeCall's meta-tools. The model searches your tools with `codecall:search`, reads the schemas of
the ones it picked with `codecall:describe`, and calls them: one at a time with `codecall:invoke`, or several in one
request with `codecall:execute`, which runs a short program written in AgentScript, a restricted subset of
JavaScript, in a sandbox on the server. A script can loop over results, filter and join them, so only the answer goes
back to the model.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-codecall.svg)](https://www.npmjs.com/package/@frontmcp/plugin-codecall) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-codecall.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-codecall @frontmcp/plugin-cache @frontmcp/sdk
```

Requires Node.js 24 or later. [`@frontmcp/plugin-cache`](https://www.npmjs.com/package/@frontmcp/plugin-cache) is a
required peer dependency: install it next to this package, at the same version. CodeCall registers the cache plugin
itself, so you don't list it in `plugins`. Keep `@frontmcp/sdk` on the same version too.

For `embedding: { strategy: 'ml' }`, also install `@huggingface/transformers`, an optional peer dependency of
`vectoriadb`, which CodeCall uses for search.

## Usage

Register the plugin with `init()`, in the `plugins` of an `@App` or of `@FrontMcp`:

```ts
import { CodeCallPlugin } from '@frontmcp/plugin-codecall';
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'list_tickets',
  description: 'List support tickets',
  inputSchema: { status: z.enum(['open', 'closed']) },
})
class ListTickets extends ToolContext {
  async execute({ status }: { status: 'open' | 'closed' }) {
    return { tickets: [{ id: 'T-1', status, customerId: 'C-7' }] };
  }
}

@Tool({ name: 'get_customer', description: 'Get a customer by id', inputSchema: { id: z.string() } })
class GetCustomer extends ToolContext {
  async execute({ id }: { id: string }) {
    return { id, name: 'Ada', plan: 'pro' };
  }
}

@App({
  id: 'help-desk',
  name: 'Help Desk',
  tools: [ListTickets, GetCustomer],
  plugins: [CodeCallPlugin.init({ mode: 'codecall_only' })],
})
class HelpDeskApp {}

@FrontMcp({ info: { name: 'help-desk', version: '1.0.0' }, apps: [HelpDeskApp] })
export default class Server {}
```

`tools/list` now shows only the `codecall:*` tools. Registered on one app, CodeCall still hides every app's tools
(unless you set `appIds`), and its tools search and call every app's tools.

Every option is optional: `CodeCallPlugin.init()` and `plugins: [CodeCallPlugin]` use the defaults. `init()` checks
the options when your module is imported, and throws a `ZodError` naming a wrong one.

## The tools CodeCall adds

| Tool                       | What it does                                                  |
| -------------------------- | ------------------------------------------------------------- |
| `codecall:search`          | Finds tools for short queries (`queries`: 1 to 10 phrases).   |
| `codecall:describe`        | Returns tools' input and output schemas, with usage examples. |
| `codecall:invoke`          | Calls one tool and returns its result.                        |
| `codecall:execute`         | Runs an AgentScript program that calls tools.                 |
| `codecall:searchSkills`    | Finds skills that call tools.                                 |
| `codecall:searchKnowledge` | Finds skills that are only instructions.                      |
| `codecall:resume`          | Resumes a paused run from the call it stopped before.         |
| `codecall:status`          | Reads a run's status: how it ended, or that it is paused.     |
| `codecall:cancel`          | Cancels a paused run.                                         |

Together they take about 18.5 KB of `tools/list` (the JSON of its `tools` array), whatever the number of tools
CodeCall searches. Their output schemas list each result's fields and keep nested objects (errors, findings,
approvals, `paused`) loose, so the list stays small; `codecall:resume` lists its answer as an object with a `status`,
since it answers as `codecall:execute` does.

They're listed in every mode, and neither `codecall:invoke` nor a script can call them. The last three come with
`runs.resume` (see [Pause and resume](#pause-and-resume)).

## Modes

| `mode`                      | In `tools/list`                                                           | What CodeCall may use                                    |
| --------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `'codecall_only'` (default) | CodeCall's tools, and tools with `codecall: { visibleInListTools: true }` | Every tool, except those with `enabledInCodeCall: false` |
| `'codecall_opt_in'`         | Every tool, except those with `visibleInListTools: false`                 | Only tools with `codecall: { enabledInCodeCall: true }`  |
| `'metadata_driven'`         | Every tool, except those with `visibleInListTools: false`                 | Every tool, except those with `enabledInCodeCall: false` |

A client that calls a tool CodeCall takes out of `tools/list` gets `Tool "…" not found` (`TOOL_NOT_FOUND`). Calls
from the server, through CodeCall's own tools or `this.callTool()`, still reach it. In `codecall_only`, a tool a
client or widget calls directly needs `visibleInListTools: true`.

The plugin adds a `codecall` field to `@Tool`:

```ts
@Tool({
  name: 'delete_customer',
  description: 'Delete a customer and all their tickets',
  inputSchema: { id: z.string() },
  codecall: { enabledInCodeCall: false, visibleInListTools: true },
})
```

## Options

| Option           | Default                | Description                                                                                                                                                     |
| ---------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`           | `'codecall_only'`      | Which tools `tools/list` shows, and which CodeCall may use. See [Modes](#modes).                                                                                |
| `appIds`         | every app              | In `codecall_only`, hide only these apps' tools from `tools/list`. It doesn't limit what CodeCall searches or calls.                                            |
| `includeTools`   |                        | `(tool) => boolean`. A tool it returns `false` for isn't searched, described, invoked or callable from scripts.                                                 |
| `directCalls`    | unset                  | `{ enabled, allowedTools?, filter? }`, limits what `codecall:invoke` may call.                                                                                  |
| `vm`             | `{ preset: 'secure' }` | The sandbox's limits: `preset` (`'locked_down'`, `'secure'`, `'balanced'`, `'experimental'`), `runtime`, `timeoutMs`, `maxToolCalls`, `allowLoops`, and others. |
| `embedding`      | TF-IDF                 | How `codecall:search` ranks tools: `strategy` (`'tfidf'` or `'ml'`), `modelName`, `cacheDir`, `useHNSW`, `synonymExpansion`.                                    |
| `sidecar`        | `{ enabled: false }`   | Allows scripts longer than 64 KB.                                                                                                                               |
| `topK`           | `8`                    | Results per query when a `codecall:search` call doesn't give its own `topK`.                                                                                    |
| `maxDefinitions` | `8`                    | Most tools one `codecall:describe` call may name.                                                                                                               |
| `runs`           | `{ enabled: true }`    | A record of each `codecall:execute` run, with a journal of its tool calls. See [Run records](#run-records).                                                     |
| `keep`           | `{ enabled: true }`    | `keep(name, value)` and `recall(name)` in scripts, for values one script hands a later one. See [Keep and recall](#keep-and-recall).                            |
| `trace`          | `{ level: 'failure' }` | The tool calls `codecall:execute` lists in its result, and the spans it sends. See [Trace](#trace).                                                             |
| `review`         | off                    | Review each script and each call with the server's rules before it runs. See [Review](#review).                                                                 |
| `budgets`        | off                    | Limit what each caller does across runs, such as records changed an hour. See [Budgets](#budgets).                                                              |

```ts
CodeCallPlugin.init({
  mode: 'codecall_opt_in',
  directCalls: { enabled: true, allowedTools: ['get_customer'] },
  vm: { preset: 'secure', timeoutMs: 3500 },
  embedding: { strategy: 'ml' },
});
```

## Limits

- **Script time and calls.** Under the default `secure` preset, a script times out after 3.5 seconds (`vm.timeoutMs`)
  and may call tools up to 5,000 times (`vm.maxToolCalls`). Loops are limited to `for…of`, and `for (…; …; …)` with
  `vm.allowLoops: true`. The other presets set other limits.
- **`vm.maxSteps` is the old name of `vm.maxToolCalls`.** It still works and still counts tool calls, not interpreter
  steps. Setting both to different values is refused when the plugin starts. Either one must be an integer from 1 to
  100,000; up to 1.12.2 a fraction or a larger number was accepted.
- **Calls to one tool.** More than `vm.rapidEnumerationThreshold` calls (default 30) to one tool within about 2
  seconds stop the script with `[RAPID_ENUMERATION]`; calls made through `parallel()` count. Set per-tool values with
  `vm.rapidEnumerationOverrides` (`{ 'users:get': 100 }`). The sandbox's message says "in 5s", but it keeps only the
  last 2 seconds of calls.
- **Embedding model.** With `embedding.strategy: 'ml'`, CodeCall loads a local model (`Xenova/all-MiniLM-L6-v2` by
  default), downloading it into `embedding.cacheDir` if it isn't there. When the model can't be loaded or used
  (offline with nothing cached, `@huggingface/transformers` missing, or embedding the tools fails), CodeCall logs one
  warning and searches with TF-IDF. A tool whose metadata can't be read is skipped with a warning; the others stay
  searchable.

## Run records

Each `codecall:execute` that has an owner (a session, or a signed-in caller) leaves a run record, and its result carries
`runId`. The record holds the owner, the script's SHA-256, the status, the start and end times, `reviewDecision` (the
[review](#review)'s or a [budget](#budgets)'s status, `'allow'` when they let the script run, `null` with `review` and
`budgets` off), the return value's size, and a journal with one entry per tool call: its position (in the order calls
reached the host, Enclave's `callIndex` + 1, on either runtime), the tool, a SHA-256 of the arguments, the outcome
(`success`, `failure` or `unfinished`), the phase of a failure (`access`, `input`, `limit`, `execute`, `result` for a
result refused after its tool ran, or `review` for a call a call-phase decision refused before it reached its tool), the
duration and the result's size. With `runs.resume` (on by default) a run also holds each call's result, or the error the
script got, and the values the script read from `Date` and `Math.random()`, in order: what it takes to run the script
again and answer its calls from the record (see [Replay](#replay)). It holds them in memory while it runs, and keeps
none of them in its record, which has the journal's metadata only, unless the run [pauses](#pause-and-resume). A `keep`
or `recall` is journaled too, under its reserved tool name (`codecall:keep`, `codecall:recall`) with `kind` (`'keep'` or
`'recall'`) and the `name` it kept or read; it is not a tool call, and its arguments and result never appear in a trace.

Records are kept like result handles: encrypted under keys derived from the run id and the owner, readable only by
that owner (`this.get(CodeCallRunStoreToken).read(runId, this)`), until they expire.

| Option                | Default            | Description                                                                                                                                            |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runs.enabled`        | `true`             | `false` keeps no records, and results carry no `runId`.                                                                                                |
| `runs.ttlSeconds`     | `600`              | How long a record can be read.                                                                                                                         |
| `runs.maxRecordBytes` | `262144` (256 KiB) | The most one record takes; journal entries past it are left out and counted. A record whose metadata alone is over it isn't kept.                      |
| `runs.resume`         | `true`             | Make runs replayable: each call's result or error, and the script's clock and random values, in memory while the run runs; pause runs and resume them. |
| `runs.pause`          | 1800 and 1800      | `{ waitSeconds, lifetimeSeconds }`: how long a paused run waits, and how long a run lives from its first start, across resumes.                        |
| `runs.storage`        | `{ type: 'auto' }` | Where records are kept, through `createStorage()`; at most 1000 records in memory.                                                                     |
| `runs.namespace`      | `'codecall-runs'`  | The key prefix of records in the storage.                                                                                                              |

A store that fails is logged as a warning, and the result goes out without `runId`.

### Replay

A run is replayed by running the same script again: each call the journal recorded gets its recorded result or error
without its tool being called, matched by its position, and its tool and arguments must be the ones recorded. A
script that makes another call at a recorded position, or ends before it made every recorded call, ends with a
`runtime_error` named `RunDivergedError`, and no call after that point runs. A script the sandbox stops before then (a
detector, a limit or a timeout) ends with the sandbox's own error instead, and one that caught the sandbox's refusal of
a call and returned ends with that refusal (`CallRefusedError`). `Date` and `Math.random()` return the
recorded values in order, then live ones, and the script's output the first run already wrote (console lines and
`mcpLog`) is not written to the server's log again.

To make a run replayable, a run kept with `runs.resume` gets its tool results in the order its calls were made, not
as each tool finishes (Enclave's `toolResultOrder: 'call'`): a slow call holds back the results of the calls after it,
never the calls themselves. A runtime that cannot give the script the host's clock keeps no clock or random values,
runs scripts as before, and refuses to replay a run. A run without an owner keeps no record, so it is not made
replayable either.

## Pause and resume

With `runs.resume` (on by default), a run that stops **before** a call ran is kept `paused`, with its journal and the
call it stopped before, instead of failing: a call-phase decision refused that call (the review's `needs_approval`, or
an uncaught `needs_changes` or `denied`, and a budget's decision of the same shape), or the call flow refused it,
uncaught, before its tool ran: its input, or a [budget](#budgets) as the tool started. The answer keeps its status
(`needs_approval`, `tool_error`, ...) and adds `paused`:

```json
{
  "status": "tool_error",
  "runId": "8f0c…",
  "paused": { "call": { "position": 3, "tool": "orders.refund" }, "expiresAt": "2026-11-25T15:30:00.000Z" }
}
```

`codecall:resume` with that `runId` runs the same script again: the calls before the paused one get their recorded
results without running again, `Date` and `Math.random()` read their recorded values, and the paused call runs live,
then the rest of the script. Its optional `arguments` replace the paused call's arguments, and only that call's; the
recorded results and the script's variables never change. A run that pauses at that same call again keeps them, so a
later resume without `arguments` runs the call with them. The answer is a `codecall:execute` result, which may pause
again at a later call. `codecall:status` reads a run's status (`paused` and until when, `resuming` while a resume
runs it, `cancelled`, or how it ended), and `codecall:cancel` ends a paused run.

- **Only before the call ran.** Whether a call reached its tool comes from FrontMCP's call flow (its input
  validation stage, and the review hooks), never from a tool's error text: a tool that throws a validation error of
  its own has run, and its run does not pause. A call that may have had an effect never pauses and is never retried.
  So a run pauses only when its paused call is its last, every call before it settled and none of them also asked for
  approval (a `parallel()` that asked twice does not pause), and its record fits whole in `runs.maxRecordBytes`. A run
  that cannot pause answers as it did before.
- **Clear of Enclave's detectors.** Enclave's rate limit (100 operations a second) and its sequence detectors (calls
  to one tool, a read then a send, within 5 to 30 seconds) read the real clock, and a replay answers its recorded calls
  at once. A paused record keeps when each call reached the host, and Enclave 2.21.1 and later judge the replayed calls
  by those times (`replayedCalls`), with the moment the paused call first reached the host placed at the resume
  (`replayedCallsResumeAtMs`). Host function calls (`getTool`, `mcpLog`, `mcpNotify`) do run again, so a run pauses
  only after fewer than 100 of them. With an older Enclave, or a record without those times, a run pauses only when it
  made its tool and host function calls up to the paused call within 5 seconds, fewer than 100 of them, and no more
  calls to one tool than `vm.rapidEnumerationThreshold` (and its overrides) allow: replaying them faster cannot trip a
  detector they passed.
- **Once.** A resume claims the pause in the run storage, setting a key only where none is: of two resumes, on this
  instance or another one sharing the storage, one runs the run and the other is told the run is not paused. The run is
  then kept `resuming` until the resumed run ends, and its claim lasts until the pause would have expired plus the
  script's timeout. A storage failure before the resumed run starts releases the claim and leaves the run paused, so
  it can be resumed again; a resume that crashed after it started leaves the run `resuming`: it is not run again. A storage without conditional
  writes (Cloudflare KV) cannot claim, and its resumes fail.
- **Its owner.** Only the session and caller that started the run can resume, read or cancel it; anyone else is told
  it is not found. A resume checks again that the caller may call each tool whose result it replays, and every live
  call goes through the policy, the review and the call flow as usual. Corrected `arguments` go to the server's
  reviewers first (`reviewer`, `provider`), as the one-call script `codecall:invoke` would send them; anything but
  `allow` is the answer, and the run stays paused.
- **Limits.** A paused run waits `runs.pause.waitSeconds` (30 minutes) and lives `runs.pause.lifetimeSeconds` (30
  minutes) from its first start, whichever ends first; after that a resume is told it is not found. The paused record
  holds the script, and the results and clock and random values of the calls before the paused one, encrypted with the
  record, to run it again; the script's SHA-256 must be the record's `scriptHash`. No other record keeps them.
- **Its call-phase hooks.** A replayed call is not reviewed again and does not go through the budgets again: a call
  that reached its tool is allowed, and a refusal the script caught (`needs_changes`, `denied`) is given again. A
  `needs_approval` is never answered from a record. The paused call is asked live, with its corrected arguments.

## Keep and recall

Each `codecall:execute` starts fresh. A script keeps a value for the caller's later scripts with `keep`, and a later
script reads it back with `recall`:

```js
// Script 1
const overdue = await callTool('invoices:list', { status: 'overdue' });
await keep('overdue', overdue.items);
return overdue.items.length;

// Script 2
const overdue = await recall('overdue');
return overdue.filter((invoice) => invoice.amount > 1000);
```

- **Both are async.** `await keep(name, value)` resolves to `undefined` once the value is kept; `await recall(name)`
  resolves to the value. A name is a string of 1 to 128 characters; a value is any JSON value but `undefined`.
- **Not found is `undefined`.** `recall` resolves to `undefined` for a name nothing is kept under: never kept, expired,
  or kept by another session or caller. The three look the same.
- **What the agent sees.** The result lists the names the script kept (`kept: ['overdue']`), never their values.
- **Who.** Values are bound to the session and the signed-in caller that kept them, as [run records](#run-records)
  are. A call with neither, a stateless anonymous one, is refused (`ACCESS_DENIED`): nobody could recall what it kept.
  `result_query` refuses such a call the same way.
- **How long, how much.** A value can be recalled for `keep.ttlSeconds`, and keeping a name again replaces its value
  and restarts its time. What one owner keeps counts against `keep.maxBytes`; a `keep` past it fails with
  `RESULT_TOO_LARGE` and keeps nothing. The bytes are reserved in an atomic counter before the value is written, so
  keeps that run at the same time, on any server instance, each count; a value counts for at most twice
  `keep.ttlSeconds`, and a value kept again under its name stops counting the one it replaced. `keep.maxBytes` is a
  soft limit: keeps that run at the same time can go past it by what is in flight, and a storage failure or a race
  can count too much until the window passes. Two keeps of the same new name at the same time both count, for
  example, so a later `keep` can be refused early; counting too much heals within twice `keep.ttlSeconds`. One owner's
  keeps never count against another's.
- **Large strings.** With the [sidecar](#options) on, a string of at least `sidecar.extractionThreshold` bytes is kept
  as a sidecar reference. A later script that recalls it by a literal name (`recall('doc')`) starts with that
  reference, and `recall` returns its token: the script can pass it to a tool, which receives the whole string, but the
  string never enters the sandbox and never counts against its memory limit. Recalled under a name that isn't a
  literal, the string is returned, and the sidecar keeps it out of the sandbox as any large tool result.
- **Calls.** `keep` and `recall` are `callTool()` calls of the reserved names `codecall:keep` and `codecall:recall`,
  which CodeCall answers itself: they count toward the script's own call limits (`vm.maxToolCalls`, calls to one tool
  within 2 seconds), reach no tool and no budget, and an MCP client can't call them. A script that declares its own
  `keep` or `recall` keeps it.

| Option            | Default            | Description                                                                            |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `keep.enabled`    | `true`             | `false` gives scripts neither function.                                                |
| `keep.ttlSeconds` | `600`              | How long a kept value can be recalled.                                                 |
| `keep.maxBytes`   | `1048576` (1 MiB)  | The most one owner's kept values take at once, as UTF-8 JSON.                          |
| `keep.storage`    | `{ type: 'auto' }` | Where kept values are kept, through `createStorage()`; at most 1000 entries in memory. |
| `keep.namespace`  | `'codecall-kept'`  | The key prefix of kept values in the storage.                                          |

Kept values are stored like run records: each one encrypted under keys derived from its name and its owner. The
bytes an owner keeps are counted with `incrBy`, which every built-in storage has but Cloudflare KV. A store that fails
is logged as a warning, and the `keep` or `recall` fails with `EXECUTION`. A `keep` refused before it writes the
value releases what it reserved. One whose write fails keeps the reservation, since the write may have been applied,
and the value it would have replaced stays kept and counted.

## Idempotency keys

Each call a script makes has an idempotency key, which the tool reads as `this.idempotencyKey`: a SHA-256 of the
run's id and the call's position in the run. Only the same call of the same run gets the same key again: when that
run's script runs again (resuming it, or after an approval) or the tool is run again for an elicitation's answer.
Every other call, and every new `codecall:execute` of the same script, has another key. A client's own `tools/call`
and `codecall:invoke` have none, and nothing a client sends can set one.

A tool that writes to another system passes the key on, the way payment APIs take an `Idempotency-Key`, so that the
same call sent again has its effect once:

```ts
@Tool({ name: 'charge_card', inputSchema: { customerId: z.string(), cents: z.number().int() } })
class ChargeCardTool extends ToolContext {
  async execute({ customerId, cents }: { customerId: string; cents: number }) {
    return payments.charges.create({ customerId, cents }, { idempotencyKey: this.idempotencyKey });
  }
}
```

It does not cover a new run: the run id is only in the result the agent gets, and a run's journal is saved with its
record when the run ends, which needs an owner (a session or a signed-in caller) and `runs` on.

## Trace

`codecall:execute` returns a short `trace` from the run's journal, one line per tool call, so the agent sees which
calls ran before a script failed:

```json
{
  "status": "tool_error",
  "trace": ["1. users-list: success, 4 ms, 412 bytes", "2. users-get: failure (input), 3 ms"]
}
```

| Option           | Default     | Description                                                                              |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `trace.level`    | `'failure'` | `'off'`, `'failure'` (only a run whose status is not `ok`) or `'calls'` (every run).     |
| `trace.maxLines` | `20`        | The most lines; the last calls are kept, and the first line counts the earlier ones.     |
| `trace.values`   | `false`     | Add each call's arguments and a successful call's result, as JSON cut to 200 characters. |

With observability on, each run is also a `codecall run` span with a `codecall call <tool>` child span per tool call,
carrying the same position, outcome, phase, duration and size, and values only with `trace.values: true`. With
`review` or `budgets` on, the run span also carries `codecall.review.decision` and the findings (`codecall.review.findings.count`,
`codecall.review.findings.rules`, and `codecall.review.findings` as JSON without suggestions, cut to 2,000
characters). With observability off, CodeCall sends no spans.

## Review

With `review` set, the server checks each script before it runs and each tool call, with the arguments it really
has, before the tool sees it. It's off by default; without it nothing changes. Turn it on with the built-in rules, a
model provider, your own function, or any mix:

```ts
CodeCallPlugin.init({
  review: {
    rules: { readThenSend: 'denied' }, // the built-in rules; `false` turns them off
    provider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4.1-mini' },
    reviewer: async ({ code, analysis, policy, tools }) => ({ decision: 'allow' }),
    policy: 'Scripts may read customers. Refunds need a person.',
  },
});
```

The built-in rules run in the server, from tool annotations and input schemas, with no model call. Only an explicit
annotation counts: an unannotated tool is not destructive or open-world here, whatever MCP's defaults say.

| Rule (`rules.*`)                   | Finds                                                                                                                   | Answer                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `inputSchema` (`true`)             | A literal argument of the wrong type or value (`limit: "20"` where a number is wanted), or the real arguments of a call | `needs_changes`, with the place and a suggestion       |
| `availability` (`true`)            | A tool outside the CodeCall policy (`includeTools`, `mode`), the caller's authorities or the script's `allowedTools`    | `denied`                                               |
| `destructive` (`true`)             | A tool with `destructiveHint: true`                                                                                     | `needs_approval`, or `denied` when nobody can approve  |
| `readThenSend` (`'needs_changes'`) | A `readOnlyHint` tool's result flowing into an `openWorldHint` tool's arguments                                         | `needs_changes`, `'denied'`, or nothing with `false`   |
| `fanOut` (`true`)                  | A call in a loop over a tool result with no bound below `vm.maxToolCalls`                                               | `needs_changes`; cut the items first (`.slice(0, 20)`) |

`provider` and `reviewer` are Enclave's `providerReviewer` and `functionReviewer`. They review the script, with its
static analysis, against `policy` (required with `provider`), and get the names and descriptions of the tools a script
may call. The script, its comments and strings, and the tool descriptions reach them as untrusted data, never as
instructions. The API key goes only into the provider request's `authorization` header; it is never logged and is
never in a result. The rules answer first, then `reviewer`, then `provider`; the first answer that isn't `allow` is
the review's.

| Option                         | Default | Description                                                                                                    |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| `review.rules`                 | all on  | The built-in rules above; `false` turns them all off.                                                          |
| `review.provider`              |         | `{ provider: 'openai', apiKey, model, baseUrl?, timeoutMs? }`; `baseUrl` is https, or http on a loopback host. |
| `review.reviewer`              |         | `({ code, analysis, policy, tools }) => ReviewDecision`, your own reviewer.                                    |
| `review.policy`                |         | Your rules for scripts, as text, for `provider` and `reviewer`.                                                |
| `review.policyVersion`         |         | Change it to ask again for every approval, for example when `reviewer` changes.                                |
| `review.timeoutMs`             | `30000` | How long one review may take; a review that takes longer fails.                                                |
| `review.approvalMaxAgeSeconds` | `3600`  | How long an approval counts after it was granted.                                                              |

With `review` on, `codecall:execute` has four more statuses, and its description lists them (with only
[`budgets`](#budgets) on, it has `needs_approval` and `denied`, and its description says what a budget stop means):

| `status`         | Payload                                                             | What the agent does                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needs_changes`  | `findings`: `rule`, `message`, `location`, `suggestion`, `toolName` | Fixes the script and sends it again.                                                                                                                                                                                  |
| `needs_approval` | `reason`, `approval`, `findings?`, `paused?`                        | Waits for a person to approve, then resumes the run with `codecall:resume` when it has `paused`, or sends the same script again.                                                                                      |
| `denied`         | `reason`, `findings?`                                               | Doesn't retry.                                                                                                                                                                                                        |
| `review_failed`  | `error.message`                                                     | Reads the message: a review that failed before the script ran nothing, and the same script can be sent again; one that failed at a call stopped the run after the calls before it, whose effects are not rolled back. |

A refused script runs no statement. A call the rules refuse while the script runs (a computed argument of the wrong
type, a computed tool name) throws in the script, which may catch it; uncaught, it ends the run with that status. A
call that needs approval stops the run, after the calls before it ran.

A call that needs approval while the script runs [pauses](#pause-and-resume) the run before it: the answer is
`needs_approval` with `runId` and `paused`, and once a person approves, `codecall:resume` runs that call, and the rest
of the script, without running the calls before it again; the call is reviewed again then, with its approval, and the
calls before it are not. A call that needs approval before the script runs asks as usual: nothing ran, and the same
script is sent again.

A run that cannot pause (without `runs.resume`, without an owner, on a runtime that cannot replay, or when its record
would not fit) would run again from the start once approved. So when its call needs approval after a call to a tool
without `readOnlyHint` has run (sending an email, say), the answer is `needs_changes`, not `needs_approval`: the
finding (`approval-after-effects`) names those tools, which already ran, and asks for the call and the calls after it
in a script of their own. No approval is asked for, by elicitation either.

### Approvals

`approval.id` covers this script (its SHA-256), the call's arguments and the review policy version. The Approval
plugin's record binds the caller (its session or user) and the expiry, and `review.approvalMaxAgeSeconds` caps the
expiry. A changed script, other arguments or another policy ask again. `approval.anyArgumentsId` covers any
arguments of that tool in that script, for as many calls per run as the grant's `metadata.maxCalls` allows; a
resumed run counts the calls to that tool it made before it paused, as its next call to the tool is made, and leaves
the approvals of its script to its live calls, which are each checked as they come. When
`provider` or `reviewer` asks for approval, `approval.id` covers the whole script. Enclave keeps their decisions by
the script's SHA-256 for 5 minutes, so the same script sent again within that time gets the same answer without a new
model call.

A person approves through one of two channels:

- **The Approval plugin** (`@frontmcp/plugin-approval`), installed on the server or CodeCall's app. Your code grants
  the id with any of its scopes, and the agent resumes the paused run (or sends the same script again when nothing
  ran yet):

  ```ts
  await this.approval.grantSessionApproval(approval.id);
  await this.approval.grantTimeLimitedApproval(approval.anyArgumentsId, 3_600_000, { metadata: { maxCalls: 20 } });
  ```

  A denial recorded for the id gives `denied`.

- **Elicitation**, with `elicitation: { enabled: true }` on the server and a client that declares it. CodeCall asks
  the person, showing the tool and its arguments; once they approve, it resumes the run from that call in the same
  request (up to 5 approvals), or runs the same script again when it could not pause there, and a decline gives
  `denied`.

Without either, a destructive call is `denied`, and the reason says why.

`codecall:invoke` is reviewed as the one-call script it stands for, with the same rules, reviewers and approvals; a
refusal is an error result whose structured content is the same payload. Tools a client calls directly (listed in
`codecall_opt_in` or `metadata_driven`, or with `visibleInListTools: true`) are not reviewed yet.

## Budgets

Limits inside one script, such as `vm.maxToolCalls`, don't stop an agent that sends 40 scripts. A budget limits what
each caller does across all of its scripts and `codecall:invoke` calls, in a fixed window. Here, once a caller has
changed 200 records in the hour, each further call needs a person's approval until the hour ends. It is a threshold,
not a hard maximum: the call that crosses it runs, so one call that changes 250 records goes through, and calls that
start together can each go past it before any of them reports:

```ts
CodeCallPlugin.init({
  budgets: {
    limits: [{ name: 'records-per-hour', counts: 'recordsChanged', limit: 200, windowSeconds: 3600 }],
    storage: { type: 'redis', redis: { url: process.env.REDIS_URL } },
  },
});
```

A tool that writes reports how many records it changed:

```ts
async execute({ ids }: { ids: string[] }) {
  const archived = await this.get(TicketStore).archive(ids);
  this.reportRecordsChanged(archived.length);
  return { archived: archived.length };
}
```

| Option                           | Default              | Description                                                                                                                |
| -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `budgets.limits[].name`          |                      | Names the budget in answers and in its keys: letters, digits, `_` and `-`, unique.                                         |
| `budgets.limits[].counts`        |                      | `'toolCalls'` or `'recordsChanged'`.                                                                                       |
| `budgets.limits[].limit`         |                      | The most a caller may use in one window.                                                                                   |
| `budgets.limits[].windowSeconds` |                      | The window's length. Windows are fixed, from the Unix epoch: `3600` is each hour on the hour.                              |
| `budgets.limits[].onExceeded`    | `'needs_approval'`   | What a call gets once its caller reached the limit: `'needs_approval'` (`'denied'` when nobody can approve) or `'denied'`. |
| `budgets.storage`                | `{ type: 'auto' }`   | Where counts and spent-grant markers are kept, through `createStorage()`. Share it across instances.                       |
| `budgets.namespace`              | `'codecall-budgets'` | The key prefix of counts in the storage.                                                                                   |

- **What counts.** `toolCalls` counts each call whose tool started: the SDK's tool flow tells CodeCall as the tool's
  `execute()` starts, after every hook before it. A call refused before that (by the CodeCall policy, its input, an
  unknown name, a rate or quota limit, or a hook that answered for the tool, such as a cache) doesn't count; a tool that
  refuses its input from inside `execute()` does. `recordsChanged` counts what the call's tool reports with
  `this.reportRecordsChanged(n)`, which reaches CodeCall with the call through the SDK, never through the result: what
  a tool returns, or what a script or client sends, is never counted. A report after the call ended, from a tool that
  ran past its timeout, counts as it comes; a remote tool's reports, and calls a client makes directly, are not
  counted.
- **Before each call, and again as it starts.** Once the caller is at or over a budget's limit in the current window,
  the call doesn't run. It gets the budget's answer at that call, as a review decision there would be, with or without
  `review` (with it, the budgets answer first): `needs_approval` stops the run after the calls before it, and `denied`
  throws in the script, which may catch it, and ends the run with `denied` when it doesn't. The finding
  (`budget-exceeded`) names the budget and when its window resets. As the tool starts, after the review and any wait
  for a person, the call is counted at once with an atomic increment of each `toolCalls` budget, and the approvals it
  needs for the budgets it is then over are spent; when it lacks one, it is taken back off the count and fails there,
  with `RATE_LIMITED` and the budget's reason in a script, and with the budget's answer from `codecall:invoke`.
  Budgets count per caller, not per run, so they carry across runs that resume; the calls a resumed run answers from
  its record are neither checked nor counted again.
- **Approving a call over a budget.** A budget's `needs_approval` carries an `approval` whose `id` covers this script,
  this call's tool and arguments, its place in the run, and that budget; it has no `anyArgumentsId`. A person grants it
  as a review approval ([Approvals](#approvals)): through the Approval plugin, or through elicitation, which asks in
  the same call, for each budget the call is over. Each grant lets exactly one call over the limit run, spent as the
  call's tool starts, and that call is counted. Sending the same script again, or the same call again, asks again, and
  a call over two budgets needs a grant for each, spent together or not at all. The call that spends an Approval
  plugin grant sets a marker in `budgets.storage` (set only if absent, kept while the grant counts, and refused once
  the grant no longer counts), so two runs, on one instance or on several sharing the store, never spend one grant. A
  budget approval and a review approval never stand for each other, so approving a destructive call never lifts a
  budget. A refused approval gives `denied`, and so does a budget stop when nobody can approve it (no Approval plugin,
  and a client that can't elicit), as review answers a destructive call.
- **A stopped run pauses.** With `runs.resume`, a run a budget stopped, before the call or as its tool started, is kept
  [paused](#pause-and-resume) at that call where it can be: once a person approves it, the window resets or the store
  answers, `codecall:resume` runs it from that call, and the calls before it are answered from the record. The
  findings say so. Where the run can't pause, an approved script runs again from the start, so once a tool without
  `readOnlyHint` ran in the script, a call over a budget gets `needs_changes` (`approval-after-effects`), as review
  answers, rather than an approval that would run that tool again. After read-only calls, the calls before the
  approved one run and count again, and each that is over the limit asks for its own approval; an approval is bound to
  its place, so an earlier identical call never spends it.
- **The call that crosses a `recordsChanged` limit runs.** A call's records changed are known only once it ran, so the
  call that takes a caller past a `recordsChanged` limit runs, and the next one is stopped; calls that start together
  can each run before any of them reports. A `toolCalls` limit holds for calls that start together, in a `parallel()`
  or in two scripts at once, since each is counted before it runs.
- **Who is a caller.** A signed-in user, or an API key in `static` auth, is one caller across its sessions. An
  anonymous caller counts per verified session; anonymous calls without a session share one count.
- **Shared counts.** Each count is one key per budget, caller (as a SHA-256) and window, added to with an atomic
  increment and kept for at least the window. On Redis or SQLite every instance on the store counts together; in
  memory each instance counts alone. CodeCall's reserved names are never counted.
- **A store that fails closes.** When the budgets can't be checked (the counts or an approval can't be read), the call
  is `denied` (`budget-unavailable`), and once a count couldn't be kept, or a refused call couldn't be taken back off
  the count, the rest of that run is too. An approval wouldn't fix a store, so it isn't asked for. The finding names
  the tools with effects that already ran in the script and tells the agent to send only the calls that did not run,
  in a new script, once the store answers, or to resume a run that paused there; a call stopped as it starts carries
  the same advice in its error.

## Runtime and process boundary

Three settings are easy to confuse, and they are separate:

- **`vm.preset`** is CodeCall's policy: the syntax a script may use and its limits. It never chooses where scripts run,
  and it never changes Enclave's security level, which is `STANDARD` for every script. No option turns off Enclave's
  validation or transformation of a script.
- **`vm.runtime`** chooses the Enclave runtime that runs scripts:
  - `'node-vm'` (the default) is Enclave's sandbox on Node's `vm` module. It runs on Node only. An explicit
    `vm.runtime: 'node-vm'` in a `frontmcp build --target cloudflare` bundle is refused when the plugin starts, because
    `nodejs_compat` only stubs `node:vm`.
  - `'interpreter'` is Enclave's validated AgentScript interpreter. It runs on Node and in Cloudflare Workers with
    `nodejs_compat`. Select it explicitly in a Worker build. It needs `@enclave-vm/core` 2.20.0 or later, which the
    plugin depends on; if an older Enclave is what resolves, execution fails closed instead of running the script.

  Neither runtime is a process boundary. Both run scripts inside the server's own process.

- **The deployment boundary** is the process or container that runs the server. On Node, running CodeCall in a
  dedicated, constrained child process or container is what contains native stderr output and a process-wide memory
  failure. A Cloudflare Worker can forward `codecall:execute` to such a service, but then the script doesn't run in the
  Worker. Changing `vm.preset` or `vm.runtime` doesn't give you this boundary.

For a Cloudflare Worker build, select the interpreter in the plugin options:

```ts
CodeCallPlugin.init({
  mode: 'codecall_only',
  vm: { preset: 'secure', runtime: 'interpreter' },
});
```

The interpreter has budgets of its own. Each one applies only with `vm.runtime: 'interpreter'`, and setting one with
`'node-vm'` (set or left as the default) is refused when the plugin starts. Each must be an integer from 1 to its
maximum. You can lower a budget, but you can't raise it past Enclave's own default or ceiling, and you can't turn it off.

| Option                   | Default   | Maximum   | What it bounds                                                                        |
| ------------------------ | --------- | --------- | ------------------------------------------------------------------------------------- |
| `vm.maxInterpreterSteps` | 1,000,000 | 5,000,000 | Interpreter instructions per script; tool calls are `vm.maxToolCalls`                 |
| `vm.memoryLimitBytes`    | 1 MiB     | 64 MiB    | What a script may allocate, by the interpreter's estimate, and the size of its result |
| `vm.maxCallDepth`        | 256       | 256       | How deep a script's calls may nest                                                    |
| `vm.maxPendingCalls`     | 4096      | 4096      | Calls of a script unfinished at once, running or waiting                              |

Time, steps, tool calls, memory and, on Cloudflare, the platform's own CPU and memory limits are all finite on purpose.
They're part of how CodeCall runs scripts safely. A sandbox can't be promised unbreakable, and none of these limits
can be removed.

## Docs

- [CodeCall reference](https://frontmcp.dev/reference/plugins/codecall): every option, the tools, AgentScript, the
  sandbox's limits and security, with runnable examples
- [Letting the Model Write Code with CodeCall](https://frontmcp.dev/learn/letting-the-model-write-code-with-codecall):
  a step-by-step lesson
- [CRM with CodeCall](https://frontmcp.dev/examples/crm-with-codecall): a whole server built on it
- [Plugins and adapters](https://frontmcp.dev/reference/plugins): where to register a plugin

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework this plugin extends
- [`@frontmcp/plugin-cache`](https://www.npmjs.com/package/@frontmcp/plugin-cache): a required peer dependency
- [`@frontmcp/plugin-skilled-openapi`](https://www.npmjs.com/package/@frontmcp/plugin-skilled-openapi): serves a
  REST API as skills, which `codecall:searchSkills` finds
- [`@frontmcp/plugins`](https://www.npmjs.com/package/@frontmcp/plugins): a meta-package that re-exports this plugin
  with three others

## Contributing

Source: [`plugins/plugin-codecall`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-codecall). Issues
and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
