/**
 * Pins the replay to the recording `CallRecorderPlugin` writes: every field of a line is one the replay knows, and
 * calls recorded against a server replay against it unchanged, errors and redacted values included.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as http from 'node:http';
import { type AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  CallRecorderPlugin,
  FrontMcpInstance,
  LogLevel,
  Prompt,
  PromptContext,
  PublicMcpError,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
} from '@frontmcp/sdk';

import { McpTestClient } from '../../client/mcp-test-client';
import { replaySession } from '../replay-session';

/** The fields the replay reads, then the ones it leaves: a field the recorder adds must be added here, and read. */
const RECORD_FIELDS = ['v', 'method', 'name', 'input', 'answer', 'error', 'session', 'client', 'at', 'durationMs'];

@Tool({ name: 'login', inputSchema: { user: z.string(), password: z.string() } })
class LoginTool extends ToolContext {
  async execute(input: { user: string; password: string }) {
    return { user: input.user, accessToken: `tok-${Date.now()}`, note: `Bearer sk-${Date.now()}-x` };
  }
}

@Tool({ name: 'pay', inputSchema: {} })
class PayTool extends ToolContext {
  async execute(): Promise<{ paid: boolean }> {
    throw new PublicMcpError('ledger offline', 'LEDGER_OFFLINE');
  }
}

@Tool({ name: 'crash', inputSchema: {} })
class CrashTool extends ToolContext {
  async execute(): Promise<{ ok: boolean }> {
    throw new Error('database unreachable');
  }
}

@Resource({ name: 'motd', uri: 'notes://motd', mimeType: 'text/plain' })
class MotdResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'Welcome' }] };
  }
}

@Prompt({ name: 'greet', arguments: [{ name: 'who', required: true }] })
class GreetPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Hello ${args['who']}` } }] };
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-recording-'));
const file = path.join(dir, 'calls.jsonl');
let node: http.Server;
let baseUrl: string;

@App({
  id: 'desk',
  name: 'Desk',
  plugins: [CallRecorderPlugin.init({ path: file })],
  tools: [LoginTool, PayTool, CrashTool],
  resources: [MotdResource],
  prompts: [GreetPrompt],
})
class DeskApp {}

function linesOf(): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').trim();
  return text === '' ? [] : text.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function untilLines(count: number): Promise<Array<Record<string, unknown>>> {
  for (let attempt = 0; attempt < 100 && linesOf().length < count; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return linesOf();
}

beforeAll(async () => {
  const handler = (await FrontMcpInstance.createHandler({
    info: { name: 'replay-recording', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
  })) as http.RequestListener;
  node = http.createServer(handler);
  await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    node.close(() => resolve());
    node.closeAllConnections();
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a CallRecorderPlugin recording', () => {
  it('holds only fields the replay knows, and replays unchanged against the server it recorded', async () => {
    const client = await McpTestClient.create({ baseUrl, publicMode: true }).buildAndConnect();
    try {
      await client.tools.call('login', { user: 'ada', password: 'hunter2' });
      await client.tools.call('pay', {});
      await client.tools.call('crash', {});
      await client.resources.read('notes://motd');
      await client.resources.read('notes://missing');
      await client.prompts.get('greet', { who: 'Ada' });
    } finally {
      await client.disconnect();
    }

    const lines = await untilLines(6);
    expect(lines).toHaveLength(6);
    for (const line of lines) {
      expect(Object.keys(line).filter((key) => !RECORD_FIELDS.includes(key))).toEqual([]);
    }
    expect(lines.map(({ error }) => error)).toEqual([
      undefined,
      { code: 'LEDGER_OFFLINE', message: 'ledger offline' },
      { code: 'TOOL_EXECUTION_ERROR' },
      undefined,
      { code: -32002, message: 'Resource not found: notes://missing' },
      undefined,
    ]);

    const report = await replaySession(file, baseUrl, { client: { publicMode: true } });
    expect(report.calls.map(({ outcome }) => outcome)).toEqual(['same', 'same', 'same', 'same', 'same', 'same']);
  });
});
