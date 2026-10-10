/**
 * A server embedded with `create()` is quiet by default (#824): without `logging` it logs at `warn`
 * (or the level FRONTMCP_LOG_LEVEL names), a tool call writes nothing at `info`, and the
 * no-distributed-storage warning appears once (the server has one scope, #825).
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { LogLevel, tool } from '../../common';
import { create } from '../create';

type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';

function captureConsole() {
  const lines: Array<{ method: ConsoleMethod; text: string }> = [];
  const methods: ConsoleMethod[] = ['log', 'info', 'debug', 'warn', 'error'];
  const spies = methods.map((method) =>
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push({ method, text: args.map(String).join(' ') });
    }),
  );
  return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

const searchTickets = tool({
  name: 'search_tickets',
  description: 'Search tickets',
  inputSchema: { query: z.string() },
})(async ({ query }) => ({ query, tickets: [] }));

async function serveAndCall(options: Record<string, unknown> = {}) {
  const output = captureConsole();
  try {
    const server = await create({ info: { name: 'help-desk', version: '1.0.0' }, tools: [searchTickets], ...options });
    for (let call = 0; call < 3; call++) await server.callTool('search_tickets', { query: 'refund' });
    await server.dispose();
  } finally {
    output.restore();
  }
  return output.lines;
}

const belowWarn = (lines: Array<{ method: ConsoleMethod }>) =>
  lines.filter((line) => line.method !== 'warn' && line.method !== 'error');

describe('create() without logging config (#824)', () => {
  const previousEnv = { nodeEnv: process.env['NODE_ENV'], logLevel: process.env['FRONTMCP_LOG_LEVEL'] };

  beforeEach(() => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['FRONTMCP_LOG_LEVEL'];
  });

  afterEach(() => {
    process.env['NODE_ENV'] = previousEnv.nodeEnv;
    if (previousEnv.logLevel === undefined) delete process.env['FRONTMCP_LOG_LEVEL'];
    else process.env['FRONTMCP_LOG_LEVEL'] = previousEnv.logLevel;
  });

  it('writes nothing below warn while starting and on each call, and the storage warning once', async () => {
    const lines = await serveAndCall();

    expect(belowWarn(lines)).toEqual([]);
    expect(lines.filter((line) => line.text.includes('No distributed storage backend'))).toHaveLength(1);
  });

  it('keeps the per-call lines below info even at the info level', async () => {
    const lines = await serveAndCall({ logging: { level: LogLevel.Info } });

    expect(lines.some((line) => line.text.includes('Initializing FrontMCP'))).toBe(true);
    expect(lines.filter((line) => line.text.includes('CallToolFlow'))).toEqual([]);
  });

  it('uses the level FRONTMCP_LOG_LEVEL names', async () => {
    process.env['FRONTMCP_LOG_LEVEL'] = 'info';

    const lines = await serveAndCall();

    expect(lines.some((line) => line.text.includes('Initializing FrontMCP'))).toBe(true);
  });
});
