---
name: record-and-replay
reference: replay-calls
level: intermediate
description: 'Record calls against one version of a server with `CallRecorderPlugin`, replay them against the next with `replaySession()`, and assert on what changed.'
tags: [testing, replay, regression, e2e]
features:
  - 'Turning on `CallRecorderPlugin` from an env var, so only a recording run writes the JSONL file'
  - 'Recording through a real `McpTestClient`, and stopping the server so the last lines are written'
  - 'Replaying with `replaySession()` and ignoring volatile fields with `**.` globs'
  - 'Asserting on `report.differences` and failing a spec with `toMatchRecording()`'
---

# Record Against v1, Replay Against v2

Record calls against one version of a server with `CallRecorderPlugin`, replay them against the next with `replaySession()`, and assert on what changed.

## Code

```typescript
// src/main.ts
import { CallRecorderPlugin, FrontMcp } from '@frontmcp/sdk';

import { ShopApp } from './apps/shop';

const callsFile = process.env.CALLS_FILE;

@FrontMcp({
  info: { name: 'shop', version: '1.0.0' },
  apps: [ShopApp],
  plugins: callsFile ? [CallRecorderPlugin.init({ path: callsFile, keepFields: ['key'] })] : [],
  auth: { mode: 'public' },
})
export default class Server {}
```

```typescript
// e2e/replay.e2e.spec.ts
import { expect, McpTestClient, replaySession, TestServer } from '@frontmcp/testing';

const VOLATILE = ['**.quotedAt', '**.quoteId'];

it('the next version answers the recorded calls as before', async () => {
  const recording = await TestServer.start({
    command: 'npx tsx src/main.ts',
    port: 0,
    env: { CALLS_FILE: 'calls.jsonl' },
  });
  const client = await McpTestClient.create({ baseUrl: recording.info.baseUrl, publicMode: true }).buildAndConnect();
  await client.tools.call('quote', { city: 'Paris' });
  await client.resources.read('notes://motd');
  await client.disconnect();
  await recording.stop(); // the server writes its last lines on shutdown

  const server = await TestServer.start({ command: 'npx tsx src/main.ts', port: 0 });
  try {
    const report = await replaySession('calls.jsonl', server, { ignore: VOLATILE, client: { publicMode: true } });
    expect(report.differences).toEqual([]);
    expect(report).toMatchRecording();
  } finally {
    await server.stop();
  }
});
```

## What This Demonstrates

- Turning on `CallRecorderPlugin` from an env var, so only a recording run writes the JSONL file
- Recording through a real `McpTestClient`, and stopping the server so the last lines are written
- Replaying with `replaySession()` and ignoring volatile fields with `**.` globs
- Asserting on `report.differences` and failing a spec with `toMatchRecording()`

## Related

- See `replay-calls` for the record format, the redaction rules and `frontmcp test --replay`
