/**
 * Call replay: CallRecorderPlugin records the calls a client makes against fixture v1, and replaySession()
 * replays them against fixture v2, which changes one answer, fails one call and fixes another.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { expect, McpTestClient, replaySession, TestServer } from '@frontmcp/testing';

const SERVER = 'apps/e2e/demo-e2e-testing/src/main.replay.ts';
const VOLATILE = ['**.quotedAt', '**.quoteId'];

function startServer(version: 'v1' | 'v2', callsFile?: string): Promise<TestServer> {
  return TestServer.start({
    command: `npx tsx ${SERVER}`,
    project: 'demo-e2e-testing',
    port: 0,
    env: { FIXTURE_VERSION: version, ...(callsFile ? { CALLS_FILE: callsFile } : {}) },
  });
}

async function replayAgainst(version: 'v1' | 'v2', file: string, ignore?: string[]) {
  const server = await startServer(version);
  try {
    return await replaySession(file, server, { ignore, client: { publicMode: true } });
  } finally {
    await server.stop();
  }
}

describe('call replay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-replay-'));
  const file = path.join(dir, 'calls.jsonl');

  beforeAll(async () => {
    const server = await startServer('v1', file);
    try {
      const client = await McpTestClient.create({ baseUrl: server.info.baseUrl, publicMode: true }).buildAndConnect();
      await client.tools.call('ping', {});
      await client.tools.call('quote', { city: 'Paris' });
      await client.tools.call('pay', {});
      await client.tools.call('refund', {});
      await client.tools.call('login', { user: 'ada', password: 'hunter2' });
      await client.resources.read('notes://motd');
      await client.prompts.get('greet', { who: 'Ada' });
      await client.disconnect();
    } finally {
      await server.stop();
    }
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records one redacted line per call', () => {
    const text = fs.readFileSync(file, 'utf8');
    const records = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method: string; name: string; error?: { code: string } });

    expect(records.map(({ method, name }) => `${method} ${name}`)).toEqual([
      'tools/call ping',
      'tools/call quote',
      'tools/call pay',
      'tools/call refund',
      'tools/call login',
      'resources/read notes://motd',
      'prompts/get greet',
    ]);
    expect(records[3].error?.code).toBe('REFUNDS_CLOSED');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('tok-e2e-secret');
  });

  it('replayed against v2, names the changed answer, the new error and the gone error', async () => {
    const report = await replayAgainst('v2', file, VOLATILE);

    expect(report.differences.map(({ name, outcome }) => ({ name, outcome }))).toEqual([
      { name: 'quote', outcome: 'changed' },
      { name: 'pay', outcome: 'new-error' },
      { name: 'refund', outcome: 'gone-error' },
    ]);
    expect(report.differences[0].changes).toEqual([
      { path: 'content.0.text.price', recorded: 12, replayed: 15 },
      { path: 'structuredContent.price', recorded: 12, replayed: 15 },
    ]);
    expect(report.differences[1].error?.code).toBe('LEDGER_OFFLINE');
    expect(() => expect(report).toMatchRecording()).toThrow('line 2 tools/call quote: changed');
  });

  it('replayed against the unchanged v1, is clean once the volatile fields are ignored', async () => {
    const strict = await replayAgainst('v1', file);
    expect(strict.differences.map(({ name }) => name)).toEqual(['quote']);

    expect(await replayAgainst('v1', file, VOLATILE)).toMatchRecording();
  });
});
