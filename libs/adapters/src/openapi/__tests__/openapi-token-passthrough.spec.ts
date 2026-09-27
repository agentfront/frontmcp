/**
 * Regression tests: the adapter must not forward the MCP client's own token to the upstream API
 * unless the server opts in with `passthroughCallerToken: true`.
 *
 * In 1.8.2 a caller's `authInfo.token` (the bearer token it presented to the MCP server) was sent
 * to the API as `Authorization: Bearer <token>` when the adapter had no credentials of its own,
 * and when every `authProviderMapper` function returned `undefined`.
 */

import * as http from 'node:http';

import type { OpenAPIV3 } from 'openapi-types';

import { FrontMcpToolTokens } from '@frontmcp/sdk';

import OpenapiAdapter from '../openapi.adapter';
import type { OpenApiAdapterOptions } from '../openapi.types';
import { createMockLogger } from './fixtures';

const CLIENT_TOKEN = 'mcp-client-token-for-the-mcp-server';

type ToolExecutor = (input: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>;
type ToolFn = (() => (input: unknown, toolCtx: { context: unknown }) => Promise<unknown>) & Record<symbol, unknown>;

function createSpec(baseUrl: string): OpenAPIV3.Document {
  return {
    openapi: '3.0.0',
    info: { title: 'Desk API', version: '1.0.0' },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        DeskToken: { type: 'http', scheme: 'bearer' },
      },
    },
    paths: {
      '/tickets/{id}': {
        get: {
          operationId: 'getTicket',
          security: [{ DeskToken: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/status': {
        get: {
          operationId: 'getStatus',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
}

describe('OpenAPI adapter - caller token passthrough (regression)', () => {
  let server: http.Server;
  let baseUrl = '';
  const received: Array<{ path: string; authorization: string | undefined }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      received.push({ path: req.url ?? '', authorization: req.headers.authorization });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  beforeEach(() => {
    received.length = 0;
  });

  let adapterCount = 0;
  async function getTool(
    name: string,
    options: Partial<OpenApiAdapterOptions> = {},
  ): Promise<{ execute: ToolExecutor; logger: ReturnType<typeof createMockLogger> }> {
    const logger = createMockLogger();
    const adapter = new OpenapiAdapter({
      name: `desk-${++adapterCount}`,
      spec: createSpec(baseUrl),
      baseUrl,
      logger,
      ...options,
    } as OpenApiAdapterOptions);
    const result = await adapter.fetch();
    const tools = (result.tools ?? []) as unknown as ToolFn[];
    const toolFn = tools.find((t) => {
      const metadata = t[FrontMcpToolTokens.metadata] as { name?: string; id?: string } | undefined;
      return (metadata?.name ?? metadata?.id) === name;
    });
    if (!toolFn) throw new Error(`tool ${name} not generated`);
    return { execute: (input, ctx) => toolFn()(input, { context: ctx }), logger };
  }

  const callerContext = { authInfo: { token: CLIENT_TOKEN, user: { sub: 'sam', tenant: 'unknown' } } };

  it('does not send the caller token when the adapter has no credentials of its own', async () => {
    const { execute } = await getTool('getTicket');

    await expect(execute({ id: 'T-1' }, callerContext)).rejects.toThrow(/Authentication required for tool 'getTicket'/);
    expect(received.map((r) => r.authorization)).not.toContain(`Bearer ${CLIENT_TOKEN}`);
    expect(received).toHaveLength(0);
  });

  it('does not send the caller token when authProviderMapper returns undefined', async () => {
    const deskTokens: Record<string, string> = { acme: 'desk-token-acme' };
    const { execute } = await getTool('getTicket', {
      authProviderMapper: {
        DeskToken: (ctx) =>
          deskTokens[(ctx.authInfo as { user?: { tenant?: string } } | undefined)?.user?.tenant ?? ''],
      },
    });

    await expect(execute({ id: 'T-1' }, callerContext)).rejects.toThrow(/Authentication required for tool 'getTicket'/);
    expect(received).toHaveLength(0);
  });

  it('sends no Authorization header to an operation without security requirements', async () => {
    const { execute } = await getTool('getStatus');

    await execute({}, callerContext);
    expect(received).toHaveLength(1);
    expect(received[0].authorization).toBeUndefined();
  });

  it('sends the mapped credential when authProviderMapper returns one', async () => {
    const { execute } = await getTool('getTicket', {
      authProviderMapper: { DeskToken: () => 'desk-token-acme' },
    });

    await execute({ id: 'T-1' }, callerContext);
    expect(received).toEqual([{ path: '/tickets/T-1', authorization: 'Bearer desk-token-acme' }]);
  });

  it('forwards the caller token only with passthroughCallerToken: true', async () => {
    const { execute } = await getTool('getTicket', { passthroughCallerToken: true });

    await execute({ id: 'T-1' }, callerContext);
    expect(received).toEqual([{ path: '/tickets/T-1', authorization: `Bearer ${CLIENT_TOKEN}` }]);
  });

  it('with passthroughCallerToken: true, falls back to the caller token when authProviderMapper returns undefined', async () => {
    const { execute } = await getTool('getTicket', {
      passthroughCallerToken: true,
      authProviderMapper: { DeskToken: () => undefined },
    });

    await execute({ id: 'T-1' }, callerContext);
    expect(received).toEqual([{ path: '/tickets/T-1', authorization: `Bearer ${CLIENT_TOKEN}` }]);
  });

  // Credential sources are tried in order: securityResolver, authProviderMapper, staticAuth, and
  // only then (with passthroughCallerToken) the caller's own token.
  describe('staticAuth after authProviderMapper', () => {
    it('sends staticAuth when authProviderMapper returns undefined', async () => {
      const { execute } = await getTool('getTicket', {
        authProviderMapper: { DeskToken: () => undefined },
        staticAuth: { jwt: 'desk-service-token' },
      });

      await execute({ id: 'T-1' }, callerContext);
      expect(received).toEqual([{ path: '/tickets/T-1', authorization: 'Bearer desk-service-token' }]);
    });

    it('sends staticAuth, not the caller token, when passthroughCallerToken is also set', async () => {
      const { execute } = await getTool('getTicket', {
        authProviderMapper: { DeskToken: () => undefined },
        staticAuth: { jwt: 'desk-service-token' },
        passthroughCallerToken: true,
      });

      await execute({ id: 'T-1' }, callerContext);
      expect(received).toEqual([{ path: '/tickets/T-1', authorization: 'Bearer desk-service-token' }]);
    });

    it('sends staticAuth for a scheme authProviderMapper has no entry for', async () => {
      const { execute } = await getTool('getTicket', {
        authProviderMapper: { OtherAuth: () => 'other-token' },
        staticAuth: { jwt: 'desk-service-token' },
      });

      await execute({ id: 'T-1' }, callerContext);
      expect(received).toEqual([{ path: '/tickets/T-1', authorization: 'Bearer desk-service-token' }]);
    });

    it('prefers the mapped credential over staticAuth', async () => {
      const { execute } = await getTool('getTicket', {
        authProviderMapper: { DeskToken: () => 'desk-token-acme' },
        staticAuth: { jwt: 'desk-service-token' },
      });

      await execute({ id: 'T-1' }, callerContext);
      expect(received).toEqual([{ path: '/tickets/T-1', authorization: 'Bearer desk-token-acme' }]);
    });
  });

  describe('schemes without an authProviderMapper entry', () => {
    it('refuses the configuration when nothing covers the scheme', async () => {
      await expect(getTool('getTicket', { authProviderMapper: { OtherAuth: () => 'other-token' } })).rejects.toThrow(
        /Missing auth provider mappings for security schemes: DeskToken/,
      );
    });

    it('accepts the configuration when passthroughCallerToken is the declared fallback, and warns', async () => {
      const { execute, logger } = await getTool('getTicket', {
        authProviderMapper: { OtherAuth: () => 'other-token' },
        passthroughCallerToken: true,
      });

      await execute({ id: 'T-1' }, callerContext);
      expect(received).toEqual([{ path: '/tickets/T-1', authorization: `Bearer ${CLIENT_TOKEN}` }]);
      const warnings = (logger.warn as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
      expect(warnings).toMatch(/passthroughCallerToken is enabled/);
      expect(warnings).toMatch(/no authProviderMapper entry.*DeskToken/);
    });
  });

  it('warns at startup when secured operations have no credential source', async () => {
    const { logger } = await getTool('getTicket');
    const warnings = (logger.warn as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnings).toMatch(/no credentials for the API/i);
  });
});
