---
name: replay-calls
description: Record the calls clients make with CallRecorderPlugin, then replay them against a new build with replaySession() or frontmcp test --replay
---

# Recording and Replaying Calls

Record real `tools/call`, `resources/read` and `prompts/get` traffic against one version of a server, then replay it against the next version and see which answers changed, which calls now fail, and which no longer fail.

Real API references:

- `CallRecorderPlugin` — built into `@frontmcp/sdk` (`libs/sdk/src/builtin/call-recorder/`). Its `Finally` hooks append one JSONL line per call a client makes.
- `replaySession(file, server, options?)` and `formatReplayReport(report)` — `@frontmcp/testing` (`libs/testing/src/replay/`).
- `expect(report).toMatchRecording()` — `@frontmcp/testing` matcher; it fails with the calls that differ.
- `frontmcp test --replay <file> [--replay-ignore <paths>]` — CLI (`libs/cli/src/commands/dev/replay.ts`).

## Record

```typescript
import { CallRecorderPlugin, FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'shop', version: '1.0.0' },
  apps: [ShopApp],
  plugins: process.env.RECORD_CALLS ? [CallRecorderPlugin.init({ path: process.env.RECORD_CALLS })] : [],
})
export default class Server {}
```

| Option         | Default                   | Meaning                                                                                        |
| -------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `path`         | `'.frontmcp/calls.jsonl'` | The JSONL file each call is appended to                                                        |
| `methods`      | all three                 | Any of `'tools/call'`, `'resources/read'`, `'prompts/get'`                                     |
| `redactFields` | `[]`                      | More field names written as `[REDACTED]`, at any depth of an input or answer                   |
| `keepFields`   | `[]`                      | Field names that look like a credential but are safe to record (the `key` of a key-value tool) |
| `maxBytes`     | `10485760` (10 MiB)       | The file stops growing at this size; the stop is logged once                                   |

Invalid options throw `CallRecorderConfigurationError` from `CallRecorderPlugin.init()`, naming each problem.

Each line holds `v`, `at`, `method`, `name` (the tool or prompt name the client asked for, or the resource URI), `input`, `answer` or `error`, `durationMs`, `session` and `client`:

- **`answer`** is what the client received: the answer after every hook and the answer stages (`fitAnswer`, `shapeAnswer`), so a folded result-handles answer is recorded folded.
- **`error`** is `{ code, message }` with the code the client saw — a tool error answer's `_meta.code` (`TOOL_NOT_FOUND`), or the JSON-RPC code of a resource or prompt (`-32002`) — and, for a public error, the text the client reads (a tool error's text includes its `To fix:` remedy line; a JSON-RPC message has no `MCP error <code>:` prefix). An internal error is recorded as `{ code }` only: its text is generic and carries a new error id each time.
- The file is created owner-only (`0600`). Lines are written in order off the call's path; while `maxBytes` of lines wait for a slow disk, later calls are dropped (logged once). `maxBytes` counts the file's size on disk, so lines another process appends to the same path count too.
- **`session`** is the first 8 characters of the session id, as the request log shows it.
- Calls a tool makes in process (`this.callTool()`) are not recorded: replaying the outer call makes them again.
- A task-augmented call is recorded once, with the answer its task produced, and replays as a plain call.

## Redaction

Review a recording before you commit it: a field such as `ssn` not listed in `redactFields`, or a secret in a shape the rules below do not know, is written as it is.

- Every field named like a credential the request log hides is `[REDACTED]`, at any depth of the input and the answer, and inside text that holds JSON. Names are matched by words, camelCase and snake_case split: `authorization`, `cookie`, `apiKey`, `access_token`, `accesstoken`, `password`, `passWord`, `client_secret`, `jwt`, `passphrase`, and any word `key`, `auth`, `token`, `secret` or `signature` — so `key`, `cacheKey` and `pageToken` / `nextPageToken` are redacted too. So is a session id field (`sessionId`, `session_id`).
- So is every field in `redactFields`.
- Inside any other text, also a tool's text block, an error message and a resource URI: a `Bearer` or `Basic` credential, a JWT, the `user:password@` of a URL, and the value given to a redacted name (`?access_token=…`, `#id_token=…`, `apiKey: "…"`, `TOKEN=…`).
- The handle of a folded result-handles answer (its encryption keys derive from it) is `[REDACTED]` wherever it appears, also in a later call that passes it to `result_query`.
- No request headers or `_meta` of a request are recorded, and the session id is cut to 8 characters.

A redacted input replays as the string `[REDACTED]`, so a call whose answer depends on it (a key-value `get({ key })`, a page token) answers differently. Name a safe field in `keepFields` to record and replay it as it was.

## Replay

```typescript
import { expect, replaySession, test } from '@frontmcp/testing';

test.use({ server: './src/main.ts', publicMode: true });

test('the new build answers the recorded calls as before', async ({ server }) => {
  const report = await replaySession('fixtures/calls.jsonl', server, {
    ignore: ['**.generatedAt', 'structuredContent.requestId'],
    client: { publicMode: true },
  });
  expect(report).toMatchRecording();
});
```

`replaySession()` replays the calls in order, one client per recorded session (with the recorded client info), and returns `{ file, calls, differences }`. Each call has an `outcome`:

| Outcome      | Meaning                                                           |
| ------------ | ----------------------------------------------------------------- |
| `same`       | The answer matches, or both failed with the same code and message |
| `changed`    | An answer path differs, or the call failed with another error     |
| `new-error`  | The recording answered and the replay failed                      |
| `gone-error` | The recording failed and the replay answered                      |

`changes` lists each differing path (`structuredContent.price`); text that holds JSON is compared as JSON (`content.0.text.price`). A value the recording redacted is not compared, and a `[REDACTED]` inside a text matches any text there (so a folded answer's new handle is not a change). Two errors differ by code (`error.code`), then, for a public error, by message (`error.message`); an internal error is compared by code only.

`ignore` takes dot paths where `*` matches one key and `**` any number of keys. Ignore timestamps, generated ids and anything else that changes on every call; `error.message` ignores the messages of errors (a server recorded in production and replayed in development words a few errors differently).

## From the CLI

```bash
frontmcp test --replay fixtures/calls.jsonl --replay-ignore '**.generatedAt,**.requestId'
```

It starts the project server the way the test fixtures do: `TestServer` runs `npx tsx <entry>` (the `entry` of `frontmcp.config`, else `package.json` `main`, else `src/main.ts`) on a free port, with the same `.env` and config overlays as `frontmcp test`. It prints the report and exits 1 when a call differs. A server that needs a token is replayed from a spec, with `client: { auth: { token } }`.

## Examples

| Example                                                              | Level        | Description                                                                                                                                              |
| -------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`record-and-replay`](../examples/replay-calls/record-and-replay.md) | Intermediate | Record calls against one version of a server with `CallRecorderPlugin`, replay them against the next with `replaySession()`, and assert on what changed. |

> See all examples in [`examples/replay-calls/`](../examples/replay-calls/)
