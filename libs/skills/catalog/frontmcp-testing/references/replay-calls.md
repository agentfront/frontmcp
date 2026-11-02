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
- **`error`** is `{ code, message }` with the code the client saw — a tool error answer's `_meta.code` (`TOOL_NOT_FOUND`), or the JSON-RPC code of a resource or prompt (`-32002`) — and the public message.
- **`session`** is the first 8 characters of the session id, as the request log shows it.
- Calls a tool makes in process (`this.callTool()`) are not recorded: replaying the outer call makes them again.

## Redaction

Nothing sensitive reaches the file:

- every field named like a credential the request log hides (`authorization`, `cookie`, `apiKey`, `access_token`, `password`, `client_secret`, ...) is `[REDACTED]`, at any depth of the input and the answer, and inside text that holds JSON;
- so is every field in `redactFields`;
- no request headers are recorded, and the session id is cut to 8 characters.

A redacted input replays as the string `[REDACTED]`. Name a safe field in `keepFields` to record and replay it as it was.

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

| Outcome      | Meaning                                                            |
| ------------ | ------------------------------------------------------------------ |
| `same`       | The answer matches, or both failed with the same code              |
| `changed`    | An answer path differs, or the call failed with another error code |
| `new-error`  | The recording answered and the replay failed                       |
| `gone-error` | The recording failed and the replay answered                       |

`changes` lists each differing path (`structuredContent.price`); text that holds JSON is compared as JSON (`content.0.text.price`). A value the recording redacted is not compared, and neither are the ids of folded result handles (`compareResultHandles: true` compares them).

`ignore` takes dot paths where `*` matches one key and `**` any number of keys. Ignore timestamps, generated ids and anything else that changes on every call.

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
