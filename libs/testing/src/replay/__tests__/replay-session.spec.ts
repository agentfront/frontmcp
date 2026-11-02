import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { McpTestClient } from '../../client/mcp-test-client';
import type { JSONRPCResponse, McpTestClientConfig } from '../../client/mcp-test-client.types';
import { ReplayRecordingError } from '../../errors';
import { formatReplayReport, replaySession } from '../replay-session';

interface FakeClient {
  config: McpTestClientConfig;
  requests: Array<{ method: string; params?: Record<string, unknown> }>;
  disconnected: boolean;
}

const clients: FakeClient[] = [];
let answer: (method: string, params?: Record<string, unknown>) => JSONRPCResponse;
let failDisconnect = false;

beforeEach(() => {
  clients.length = 0;
  failDisconnect = false;
  answer = () => ({ jsonrpc: '2.0', id: 1, result: { content: [] } });
  jest.spyOn(McpTestClient, 'create').mockImplementation((config: McpTestClientConfig) => {
    const client: FakeClient = { config, requests: [], disconnected: false };
    clients.push(client);
    const connected = {
      raw: {
        request: async (message: { method: string; params?: Record<string, unknown> }) => {
          client.requests.push({ method: message.method, params: message.params });
          return answer(message.method, message.params);
        },
      },
      disconnect: async () => {
        client.disconnected = true;
        if (failDisconnect) throw new Error('socket already closed');
      },
    };
    return { buildAndConnect: async () => connected } as unknown as ReturnType<typeof McpTestClient.create>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function recording(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
  const file = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(file, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'));
  return file;
}

const base = { v: 1, at: '2026-11-02T10:00:00.000Z', durationMs: 3 };

describe('replaySession', () => {
  it('replays each call in order, one client per recorded session with its client info', async () => {
    const file = recording([
      {
        ...base,
        method: 'tools/call',
        name: 'quote',
        input: { city: 'Paris' },
        answer: {},
        session: 'aaaaaaaa...',
        client: { name: 'desk', version: '1.0.0' },
      },
      { ...base, method: 'resources/read', name: 'notes://motd', answer: {}, session: 'bbbbbbbb...' },
      '',
      { ...base, method: 'prompts/get', name: 'greet', input: { who: 'Ada' }, answer: {}, session: 'aaaaaaaa...' },
    ]);

    await replaySession(file, { info: { baseUrl: 'http://localhost:3999' } }, { client: { publicMode: true } });

    expect(clients.map(({ config, requests, disconnected }) => ({ config, requests, disconnected }))).toEqual([
      {
        config: { publicMode: true, baseUrl: 'http://localhost:3999', clientInfo: { name: 'desk', version: '1.0.0' } },
        requests: [
          { method: 'tools/call', params: { name: 'quote', arguments: { city: 'Paris' } } },
          { method: 'prompts/get', params: { name: 'greet', arguments: { who: 'Ada' } } },
        ],
        disconnected: true,
      },
      {
        config: { publicMode: true, baseUrl: 'http://localhost:3999' },
        requests: [{ method: 'resources/read', params: { uri: 'notes://motd' } }],
        disconnected: true,
      },
    ]);
  });

  it('reports each call by its line, and the calls that differ', async () => {
    const file = recording([
      { ...base, method: 'tools/call', name: 'ping', answer: { structuredContent: { ok: true } } },
      { ...base, method: 'tools/call', name: 'quote', answer: { structuredContent: { price: 12 } } },
      { ...base, method: 'resources/read', name: 'notes://gone', error: { code: -32002, message: 'not found' } },
    ]);
    answer = (method, params) => {
      if (method === 'resources/read') return { jsonrpc: '2.0', id: 3, result: { contents: [] } };
      const price = params?.['name'] === 'quote' ? { price: 15 } : { ok: true };
      return { jsonrpc: '2.0', id: 1, result: { structuredContent: price } };
    };

    const report = await replaySession(file, 'http://localhost:3999');

    expect(report.calls.map(({ line, name, outcome }) => ({ line, name, outcome }))).toEqual([
      { line: 1, name: 'ping', outcome: 'same' },
      { line: 2, name: 'quote', outcome: 'changed' },
      { line: 3, name: 'notes://gone', outcome: 'gone-error' },
    ]);
    expect(report.differences.map(({ line }) => line)).toEqual([2, 3]);
    expect(clients[0].config).toEqual({ baseUrl: 'http://localhost:3999' });
  });

  it('returns the report when a client fails to disconnect', async () => {
    const file = recording([{ ...base, method: 'tools/call', name: 'ping', answer: { content: [] } }]);
    failDisconnect = true;

    const report = await replaySession(file, 'http://localhost:3999');

    expect(report.differences).toEqual([]);
    expect(clients[0].disconnected).toBe(true);
  });

  it('refuses a line that is not a call record, naming the line', async () => {
    const file = recording([{ ...base, method: 'tools/call', name: 'ping', answer: {} }, '{"method":"tools/list"}']);

    await expect(replaySession(file, 'http://localhost:3999')).rejects.toThrow(ReplayRecordingError);
    await expect(replaySession(file, 'http://localhost:3999')).rejects.toThrow(/calls\.jsonl line 2/);
    expect(clients).toEqual([]);
  });

  it('reads a recorded error without a message', async () => {
    const file = recording([{ ...base, method: 'tools/call', name: 'crash', error: { code: 'TOOL_EXECUTION_ERROR' } }]);
    answer = () => ({
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [{ type: 'text', text: 'boom' }],
        _meta: { errorId: 'e', code: 'TOOL_EXECUTION_ERROR' },
      },
    });

    expect((await replaySession(file, 'http://localhost:3999')).differences).toEqual([]);
  });

  it('refuses a line that is not JSON', async () => {
    const file = recording(['{not json']);

    await expect(replaySession(file, 'http://localhost:3999')).rejects.toThrow(/line 1 is not a call record/);
  });
});

describe('formatReplayReport', () => {
  it('names each call that differs, and why', () => {
    const text = formatReplayReport({
      file: 'calls.jsonl',
      calls: [],
      differences: [
        {
          line: 2,
          method: 'tools/call',
          name: 'quote',
          outcome: 'changed',
          changes: [{ path: 'structuredContent.price', recorded: 12, replayed: 15 }],
        },
        {
          line: 4,
          method: 'tools/call',
          name: 'pay',
          outcome: 'new-error',
          changes: [],
          error: { code: 'LEDGER_OFFLINE', message: 'ledger offline' },
        },
        {
          line: 5,
          method: 'resources/read',
          name: 'notes://gone',
          outcome: 'gone-error',
          changes: [],
          error: { code: -32603 },
        },
        {
          line: 6,
          method: 'tools/call',
          name: 'note',
          outcome: 'changed',
          changes: [{ path: 'structuredContent.text', recorded: 'x'.repeat(200), replayed: undefined }],
        },
      ],
    });

    expect(text).toBe(
      [
        'Replayed 0 calls from calls.jsonl: 4 differ',
        '  line 2 tools/call quote: changed',
        '    structuredContent.price: 12 -> 15',
        '  line 4 tools/call pay: new error',
        '    LEDGER_OFFLINE: ledger offline',
        '  line 5 resources/read notes://gone: gone error',
        '    -32603',
        '  line 6 tools/call note: changed',
        `    structuredContent.text: "${'x'.repeat(76)}... -> (none)`,
      ].join('\n'),
    );
  });

  it('says so when every call replays the same', () => {
    expect(formatReplayReport({ file: 'calls.jsonl', calls: [], differences: [] })).toBe(
      'Replayed 0 calls from calls.jsonl: every call answered as recorded',
    );
  });
});
