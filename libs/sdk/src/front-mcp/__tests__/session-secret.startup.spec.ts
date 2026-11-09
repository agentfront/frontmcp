/**
 * In production, a server that serves MCP over HTTP encrypts the session ids of clients before MCP 2026-07-28 with
 * MCP_SESSION_SECRET. It used to start without it, then answer those clients' `initialize` with 500
 * SESSION_SECRET_REQUIRED while `/healthz` answered 200. A server that falls back to the session pipeline now
 * refuses to start; one that falls back to MCP 2026-07-28 starts, and `/readyz` reports the missing secret.
 */
import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpServerInstance } from '../../server/server.instance';
import { FrontMcpInstance } from '../front-mcp';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

function serverConfig(extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: { name: 'session-secret', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off, enableConsole: false },
    ...extra,
  };
}

const REFUSED = {
  code: 'SESSION_SECRET_REQUIRED',
  message: expect.stringContaining('set MCP_SESSION_SECRET'),
};

describe('MCP_SESSION_SECRET at startup', () => {
  const saved = { nodeEnv: process.env['NODE_ENV'], secret: process.env['MCP_SESSION_SECRET'] };

  beforeEach(() => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['MCP_SESSION_SECRET'];
    jest.spyOn(FrontMcpServerInstance.prototype, 'start').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of [
      ['NODE_ENV', saved.nodeEnv],
      ['MCP_SESSION_SECRET', saved.secret],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('a server that falls back to the session pipeline', () => {
    it.each([
      ['bootstrap()', () => FrontMcpInstance.bootstrap(serverConfig())],
      ['createHandler()', () => FrontMcpInstance.createHandler(serverConfig())],
      [
        'runUnixSocket()',
        () => FrontMcpInstance.runUnixSocket({ ...serverConfig(), socketPath: '/tmp/frontmcp-secret-test.sock' }),
      ],
      [
        'createFetchHandler() with defaultProtocolVersion legacy',
        () => FrontMcpInstance.createFetchHandler(serverConfig({ transport: { defaultProtocolVersion: 'legacy' } })),
      ],
    ])('%s refuses to start without it', async (_label, start) => {
      await expect(start()).rejects.toMatchObject(REFUSED);
    });

    it('starts with it', async () => {
      process.env['MCP_SESSION_SECRET'] = 'session-secret-startup-spec-0123456789abcdef';
      await expect(FrontMcpInstance.createHandler(serverConfig())).resolves.toBeDefined();
    });

    it('starts without it outside production', async () => {
      process.env['NODE_ENV'] = 'test';
      await expect(FrontMcpInstance.createHandler(serverConfig())).resolves.toBeDefined();
    });
  });

  describe('a server that falls back to MCP 2026-07-28', () => {
    it('starts, and /readyz stays ready with a degraded session-secret check', async () => {
      const handler = await FrontMcpInstance.createFetchHandler(serverConfig({ health: { includeDetails: true } }));

      const response = await handler(new Request('https://desk.example.com/readyz'));
      const body = (await response.json()) as { status: string; probes?: Record<string, { status: string }> };

      expect(response.status).toBe(200);
      expect(body.status).toBe('ready');
      expect(body.probes?.['session-secret']).toMatchObject({
        status: 'degraded',
        error: expect.stringContaining('MCP_SESSION_SECRET'),
      });
    });

    it('starts through createHandler() when the config sets the fallback', async () => {
      await expect(
        FrontMcpInstance.createHandler(serverConfig({ transport: { defaultProtocolVersion: '2026-07-28' } })),
      ).resolves.toBeDefined();
    });

    it('has no session-secret check when the secret is set', async () => {
      process.env['MCP_SESSION_SECRET'] = 'session-secret-startup-spec-0123456789abcdef';
      const handler = await FrontMcpInstance.createFetchHandler(serverConfig({ health: { includeDetails: true } }));

      const body = (await (await handler(new Request('https://desk.example.com/readyz'))).json()) as {
        probes?: Record<string, unknown>;
      };

      expect(body.probes?.['session-secret']).toBeUndefined();
    });
  });

  it('is not needed by a server that does not serve HTTP', async () => {
    const server = await FrontMcpInstance.createDirect(serverConfig());
    await server.dispose();
  });
});
