/**
 * Regression tests: an operation that requires authentication is sent only with a credential for
 * one of its own security schemes.
 *
 * In 1.8.3 the adapter checked only that the security context held some credential. With
 * `passthroughCallerToken: true` the caller's token is always there, as a bearer token (`jwt`), so
 * an operation whose only scheme is an API key went out with no key and no `Authorization` header
 * instead of failing with `Authentication required for tool '…'`. The same happened with a
 * `staticAuth` holding only a bearer token, and with an OAuth2 scheme, which reads `oauth2Token`.
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

interface ReceivedRequest {
  path: string;
  authorization: string | undefined;
  reportsKey: string | undefined;
}

function createSpec(baseUrl: string): OpenAPIV3.Document {
  return {
    openapi: '3.0.0',
    info: { title: 'Desk API', version: '1.0.0' },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        DeskToken: { type: 'http', scheme: 'bearer' },
        ReportsKey: { type: 'apiKey', in: 'header', name: 'X-Reports-Key' },
        ExportKey: { type: 'apiKey', in: 'query', name: 'export_key' },
        DeskSession: { type: 'apiKey', in: 'cookie', name: 'desk_session' },
        DeskOAuth: {
          type: 'oauth2',
          flows: { clientCredentials: { tokenUrl: 'https://auth.example.com/token', scopes: {} } },
        },
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
      '/reports/weekly': {
        get: {
          operationId: 'weeklyReport',
          security: [{ ReportsKey: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/exports/latest': {
        get: {
          operationId: 'latestExport',
          security: [{ ExportKey: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/session': {
        get: {
          operationId: 'sessionInfo',
          security: [{ DeskSession: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/exports': {
        get: {
          operationId: 'listExports',
          security: [{ DeskOAuth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
}

/** One operation that needs both a bearer token and an API key (`security: [{ DeskToken, ReportsKey }]`). */
function hybridSpec(baseUrl: string): OpenAPIV3.Document {
  const spec = createSpec(baseUrl);
  return {
    ...spec,
    paths: {
      '/reports/hybrid': {
        get: {
          operationId: 'hybridReport',
          security: [{ DeskToken: [], ReportsKey: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
}

function reportsOnlySpec(baseUrl: string): OpenAPIV3.Document {
  const spec = createSpec(baseUrl);
  return { ...spec, paths: { '/reports/weekly': spec.paths['/reports/weekly'] } };
}

describe('OpenAPI adapter - a credential for the operation’s own scheme (regression)', () => {
  let server: http.Server;
  let baseUrl = '';
  const received: ReceivedRequest[] = [];
  const cookies: Array<string | undefined> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      cookies.push(req.headers.cookie);
      const reportsKey = req.headers['x-reports-key'];
      received.push({
        path: req.url ?? '',
        authorization: req.headers.authorization,
        reportsKey: Array.isArray(reportsKey) ? reportsKey.join(',') : reportsKey,
      });
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
    cookies.length = 0;
  });

  let adapterCount = 0;
  async function startAdapter(
    options: Partial<OpenApiAdapterOptions> = {},
    spec?: OpenAPIV3.Document,
  ): Promise<{ tool: (name: string) => ToolExecutor; logger: ReturnType<typeof createMockLogger> }> {
    const logger = createMockLogger();
    const adapter = new OpenapiAdapter({
      name: `desk-${++adapterCount}`,
      spec: spec ?? createSpec(baseUrl),
      baseUrl,
      logger,
      ...options,
    } as OpenApiAdapterOptions);
    const result = await adapter.fetch();
    const tools = (result.tools ?? []) as unknown as ToolFn[];
    return {
      logger,
      tool: (name) => {
        const toolFn = tools.find((t) => {
          const metadata = t[FrontMcpToolTokens.metadata] as { name?: string; id?: string } | undefined;
          return (metadata?.name ?? metadata?.id) === name;
        });
        if (!toolFn) throw new Error(`tool ${name} not generated`);
        return (input, ctx) => toolFn()(input, { context: ctx });
      },
    };
  }

  const callerContext = { authInfo: { token: CLIENT_TOKEN, user: { sub: 'sam' } } };
  const warningsOf = (logger: ReturnType<typeof createMockLogger>) =>
    (logger.warn as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
  const infosOf = (logger: ReturnType<typeof createMockLogger>) =>
    (logger.info as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');

  describe('passthroughCallerToken: true', () => {
    it('refuses an API-key operation instead of sending it with no key', async () => {
      const { tool } = await startAdapter({ passthroughCallerToken: true });

      await expect(tool('weeklyReport')({}, callerContext)).rejects.toThrow(
        /Authentication required for tool 'weeklyReport'/,
      );
      expect(received).toHaveLength(0);
    });

    it('refuses an OAuth2 operation, whose scheme the forwarded bearer token does not fill', async () => {
      const { tool } = await startAdapter({ passthroughCallerToken: true });

      await expect(tool('listExports')({}, callerContext)).rejects.toThrow(
        /Authentication required for tool 'listExports'/,
      );
      expect(received).toHaveLength(0);
    });

    it('still forwards the caller token to a bearer operation', async () => {
      const { tool } = await startAdapter({ passthroughCallerToken: true });

      await tool('getTicket')({ id: 'T-1' }, callerContext);
      expect(received).toEqual([
        { path: '/tickets/T-1', authorization: `Bearer ${CLIENT_TOKEN}`, reportsKey: undefined },
      ]);
    });

    it('sends the API-key operation when staticAuth supplies the key', async () => {
      const { tool } = await startAdapter({ passthroughCallerToken: true, staticAuth: { apiKey: 'reports-key-1' } });

      await tool('weeklyReport')({}, callerContext);
      expect(received).toEqual([{ path: '/reports/weekly', authorization: undefined, reportsKey: 'reports-key-1' }]);
    });

    it('refuses API-key operations whose key goes in the query or a cookie', async () => {
      const { tool } = await startAdapter({ passthroughCallerToken: true });

      await expect(tool('latestExport')({}, callerContext)).rejects.toThrow(
        /Authentication required for tool 'latestExport'/,
      );
      await expect(tool('sessionInfo')({}, callerContext)).rejects.toThrow(
        /Authentication required for tool 'sessionInfo'/,
      );
      expect(received).toHaveLength(0);
    });

    it('sends the query and cookie API keys staticAuth supplies', async () => {
      const { tool } = await startAdapter({ passthroughCallerToken: true, staticAuth: { apiKey: 'desk-key' } });

      await tool('latestExport')({}, callerContext);
      await tool('sessionInfo')({}, callerContext);
      expect(received.map((r) => r.path)).toEqual(['/exports/latest?export_key=desk-key', '/session']);
      expect(cookies[1]).toBe('desk_session=desk-key');
    });

    it('refuses to start when an authProviderMapper has no entry for an API-key scheme', async () => {
      await expect(
        startAdapter({
          passthroughCallerToken: true,
          authProviderMapper: {
            DeskToken: () => undefined,
            DeskOAuth: () => 'oauth-token',
            ExportKey: () => 'export-key',
            DeskSession: () => 'session-key',
          },
        }),
      ).rejects.toThrow(/Missing auth provider mappings for security schemes: ReportsKey\n/);
    });

    it('names in its startup warning only the schemes the caller token reaches', async () => {
      const { logger } = await startAdapter({ passthroughCallerToken: true });
      const warnings = warningsOf(logger);

      expect(warnings).toMatch(/passthroughCallerToken is enabled.*for security schemes: DeskToken\./);
      expect(warnings).toMatch(/no credentials for the API.*ReportsKey/);
    });
  });

  describe('credentials that do not fit the scheme', () => {
    it('refuses an API-key operation when staticAuth holds only a bearer token', async () => {
      const { tool } = await startAdapter({ staticAuth: { jwt: 'desk-service-token' } });

      await expect(tool('weeklyReport')({}, callerContext)).rejects.toThrow(
        /Authentication required for tool 'weeklyReport'/,
      );
      expect(received).toHaveLength(0);
    });

    it('sends the operation when additionalHeaders carries the key', async () => {
      const { tool } = await startAdapter({
        staticAuth: { jwt: 'desk-service-token' },
        additionalHeaders: { 'X-Reports-Key': 'reports-key-2' },
      });

      await tool('weeklyReport')({}, callerContext);
      expect(received).toEqual([{ path: '/reports/weekly', authorization: undefined, reportsKey: 'reports-key-2' }]);
    });
  });

  describe('startup error for a scheme with no authProviderMapper entry', () => {
    it('suggests mapper functions that take the request context, and passthroughCallerToken only for bearer schemes', async () => {
      const error = await startAdapter({ authProviderMapper: {} }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;

      const missingLine = message.split('\n').find((line) => line.startsWith('Missing auth provider mappings'));
      expect(missingLine?.split(': ')[1]?.split(', ').sort()).toEqual([
        'DeskOAuth',
        'DeskSession',
        'DeskToken',
        'ExportKey',
        'ReportsKey',
      ]);
      expect(message).not.toContain('(authInfo) =>');
      expect(message).toMatch(/'DeskToken': \(ctx\) =>/);
      expect(message).toMatch(/'ReportsKey': \(ctx\) =>/);
      expect(message).toMatch(/passthroughCallerToken: true.*DeskToken/);
      expect(message).not.toMatch(/passthroughCallerToken: true.*ReportsKey/);
    });

    it('does not suggest passthroughCallerToken when no missing scheme is a bearer scheme', async () => {
      const error = await startAdapter({ authProviderMapper: {} }, reportsOnlySpec(baseUrl)).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Missing auth provider mappings for security schemes: ReportsKey/);
      expect((error as Error).message).not.toContain('passthroughCallerToken');
    });
  });

  // G357b: a credential the request carries through `additionalHeaders` or `headersMapper` counts.
  describe('credentials from additionalHeaders and headersMapper', () => {
    it('sends an API-key operation whose key additionalHeaders carries, with no credential option', async () => {
      const { tool } = await startAdapter({ additionalHeaders: { 'X-Reports-Key': 'reports-key-3' } });

      await tool('weeklyReport')({}, callerContext);
      expect(received).toEqual([{ path: '/reports/weekly', authorization: undefined, reportsKey: 'reports-key-3' }]);
    });

    it('sends bearer and OAuth2 operations whose Authorization headersMapper sets', async () => {
      const { tool } = await startAdapter({
        headersMapper: (_ctx, headers) => {
          headers.set('Authorization', 'Bearer desk-token-from-mapper');
          return headers;
        },
      });

      await tool('getTicket')({ id: 'T-1' }, callerContext);
      await tool('listExports')({}, callerContext);
      expect(received.map((r) => r.authorization)).toEqual([
        'Bearer desk-token-from-mapper',
        'Bearer desk-token-from-mapper',
      ]);
    });

    it('sends a cookie API-key operation whose cookie headersMapper sets', async () => {
      const { tool } = await startAdapter({
        headersMapper: (_ctx, headers) => {
          headers.set('Cookie', 'desk_session=session-from-mapper');
          return headers;
        },
      });

      await tool('sessionInfo')({}, callerContext);
      expect(cookies).toEqual(['desk_session=session-from-mapper']);
    });

    it('still refuses when headersMapper supplies nothing for the scheme', async () => {
      const { tool } = await startAdapter({
        headersMapper: (_ctx, headers) => {
          headers.set('X-Tenant-ID', 'acme');
          return headers;
        },
      });

      await expect(tool('getTicket')({ id: 'T-1' }, callerContext)).rejects.toThrow(
        /Authentication required for tool 'getTicket'/,
      );
      expect(received).toHaveLength(0);
    });

    // Startup takes the same sources: a scheme an authProviderMapper leaves out is not missing when the
    // request's own headers carry its credential.
    const mapperWithoutReportsKey = {
      DeskToken: () => 'desk-token',
      DeskOAuth: () => 'oauth-token',
      ExportKey: () => 'export-key',
      DeskSession: () => 'session-key',
    };

    it('starts with an authProviderMapper when additionalHeaders carries the scheme it leaves out', async () => {
      const { tool } = await startAdapter({
        authProviderMapper: mapperWithoutReportsKey,
        additionalHeaders: { 'X-Reports-Key': 'reports-key-4' },
      });

      await tool('weeklyReport')({}, callerContext);
      expect(received).toEqual([{ path: '/reports/weekly', authorization: undefined, reportsKey: 'reports-key-4' }]);
    });

    it('starts with an authProviderMapper when headersMapper may set the scheme it leaves out', async () => {
      const { tool, logger } = await startAdapter({
        authProviderMapper: mapperWithoutReportsKey,
        headersMapper: (_ctx, headers) => {
          headers.set('X-Reports-Key', 'reports-key-5');
          return headers;
        },
      });

      expect(warningsOf(logger) + '\n' + infosOf(logger)).toMatch(/ReportsKey.*headersMapper/);
      await tool('weeklyReport')({}, callerContext);
      expect(received).toEqual([{ path: '/reports/weekly', authorization: undefined, reportsKey: 'reports-key-5' }]);
    });

    it('still refuses at call time when that headersMapper sets nothing for the scheme', async () => {
      const { tool } = await startAdapter({
        authProviderMapper: mapperWithoutReportsKey,
        headersMapper: (_ctx, headers) => headers,
      });

      await expect(tool('weeklyReport')({}, callerContext)).rejects.toThrow(
        /Authentication required for tool 'weeklyReport'/,
      );
      expect(received).toHaveLength(0);
    });

    it('still refuses to start when the scheme it leaves out takes its key in the query', async () => {
      const { ExportKey: _exportKey, ...mapperWithoutExportKey } = mapperWithoutReportsKey;
      await expect(
        startAdapter({
          authProviderMapper: { ...mapperWithoutExportKey, ReportsKey: () => 'reports-key' },
          headersMapper: (_ctx, headers) => headers,
          additionalHeaders: { export_key: 'export-key' },
        }),
      ).rejects.toThrow(/Missing auth provider mappings for security schemes: ExportKey\n/);
    });

    it('does not take a header for an API key that goes in the query', async () => {
      const { tool } = await startAdapter({ additionalHeaders: { export_key: 'export-key' } });

      await expect(tool('latestExport')({}, callerContext)).rejects.toThrow(
        /Authentication required for tool 'latestExport'/,
      );
      expect(received).toHaveLength(0);
    });
  });

  // G357c: a credential the tool input carries (`securitySchemesInInput`, `includeSecurityInInput`)
  // reaches the API and counts.
  describe('credentials from the tool input', () => {
    it('sends the API key the input carries with securitySchemesInInput', async () => {
      const { tool } = await startAdapter({ securitySchemesInInput: ['ReportsKey'] }, reportsOnlySpec(baseUrl));

      await tool('weeklyReport')({ ReportsKey: 'key-from-input' }, callerContext);
      expect(received).toEqual([{ path: '/reports/weekly', authorization: undefined, reportsKey: 'key-from-input' }]);
    });

    it('sends each credential the input carries with includeSecurityInInput, where its scheme puts it', async () => {
      const { tool } = await startAdapter({ generateOptions: { includeSecurityInInput: true } });

      await tool('getTicket')({ id: 'T-1', DeskToken: 'token-from-input' }, callerContext);
      await tool('listExports')({ DeskOAuth: 'Bearer oauth-from-input' }, callerContext);
      await tool('weeklyReport')({ ReportsKey: 'key-from-input' }, callerContext);
      await tool('latestExport')({ ExportKey: 'export-from-input' }, callerContext);
      await tool('sessionInfo')({ DeskSession: 'session-from-input' }, callerContext);

      expect(received.map(({ path, authorization, reportsKey }) => [path, authorization, reportsKey])).toEqual([
        ['/tickets/T-1', 'Bearer token-from-input', undefined],
        ['/exports', 'Bearer oauth-from-input', undefined],
        ['/reports/weekly', undefined, 'key-from-input'],
        ['/exports/latest?export_key=export-from-input', undefined, undefined],
        ['/session', undefined, undefined],
      ]);
      expect(cookies[4]).toBe('desk_session=session-from-input');
    });

    it('sends the credentials the input carries for the schemes an includeSecurityInInput list names', async () => {
      const { tool } = await startAdapter(
        { generateOptions: { includeSecurityInInput: ['ReportsKey'] } },
        reportsOnlySpec(baseUrl),
      );

      await tool('weeklyReport')({ ReportsKey: 'key-from-input' }, callerContext);
      expect(received).toEqual([{ path: '/reports/weekly', authorization: undefined, reportsKey: 'key-from-input' }]);
    });

    it('still needs a server credential for the schemes an includeSecurityInInput list leaves out', async () => {
      // The list puts DeskToken in the input; ReportsKey has no credential source at all.
      await expect(
        startAdapter({ generateOptions: { includeSecurityInInput: ['DeskToken'] } }, hybridSpec(baseUrl)),
      ).rejects.toThrow(/ReportsKey/);

      const { tool } = await startAdapter(
        {
          generateOptions: { includeSecurityInInput: ['DeskToken'] },
          authProviderMapper: { ReportsKey: () => 'server-key' },
        },
        hybridSpec(baseUrl),
      );
      await tool('hybridReport')({ DeskToken: 'user-token' }, callerContext);
      expect(received).toEqual([
        { path: '/reports/hybrid', authorization: 'Bearer user-token', reportsKey: 'server-key' },
      ]);
    });

    it('warns that the model chooses the credential of the schemes an includeSecurityInInput list names', async () => {
      const { logger } = await startAdapter(
        { generateOptions: { includeSecurityInInput: ['ReportsKey'] } },
        reportsOnlySpec(baseUrl),
      );
      expect(warningsOf(logger)).toMatch(/SECURITY WARNING:.*ReportsKey/);
      expect(infosOf(logger)).toContain('Security Risk Score: HIGH');
    });

    it('combines an input credential with one the server resolves (the README hybrid setup)', async () => {
      const { tool } = await startAdapter(
        { securitySchemesInInput: ['DeskToken'], authProviderMapper: { ReportsKey: () => 'server-key' } },
        hybridSpec(baseUrl),
      );

      await tool('hybridReport')({ DeskToken: 'user-token' }, callerContext);
      expect(received).toEqual([
        { path: '/reports/hybrid', authorization: 'Bearer user-token', reportsKey: 'server-key' },
      ]);
    });

    it("uses the server's credential over the input's for the same scheme", async () => {
      const serverSources: Array<[string, Partial<OpenApiAdapterOptions>]> = [
        ['staticAuth', { staticAuth: { apiKey: 'server-key' } }],
        ['authProviderMapper', { authProviderMapper: { ReportsKey: () => 'server-key' } }],
        ['securityResolver', { securityResolver: async () => ({ apiKey: 'server-key' }) }],
        ['additionalHeaders', { additionalHeaders: { 'X-Reports-Key': 'server-key' } }],
        [
          'headersMapper',
          {
            headersMapper: (_ctx, headers) => {
              headers.set('X-Reports-Key', 'server-key');
              return headers;
            },
          },
        ],
      ];
      for (const [, options] of serverSources) {
        const { tool } = await startAdapter(
          { securitySchemesInInput: ['ReportsKey'], ...options },
          reportsOnlySpec(baseUrl),
        );
        await tool('weeklyReport')({ ReportsKey: 'attacker-key' }, callerContext);
      }

      expect(received.map((r) => r.reportsKey)).toEqual(serverSources.map(() => 'server-key'));
    });

    it('sends the server credential when the input leaves its credential out', async () => {
      const serverSources: Array<Partial<OpenApiAdapterOptions>> = [
        { staticAuth: { apiKey: 'server-key' } },
        { authProviderMapper: { ReportsKey: () => 'server-key' } },
        { additionalHeaders: { 'X-Reports-Key': 'server-key' } },
      ];
      for (const options of serverSources) {
        const { tool } = await startAdapter(
          { securitySchemesInInput: ['ReportsKey'], ...options },
          reportsOnlySpec(baseUrl),
        );
        await tool('weeklyReport')({}, callerContext);
      }

      expect(received.map((r) => r.reportsKey)).toEqual(serverSources.map(() => 'server-key'));
    });

    it('uses the input credential when the server has none for this caller', async () => {
      const { tool } = await startAdapter(
        { securitySchemesInInput: ['ReportsKey'], authProviderMapper: { ReportsKey: () => undefined } },
        reportsOnlySpec(baseUrl),
      );

      await tool('weeklyReport')({ ReportsKey: 'key-from-input' }, callerContext);
      expect(received.map((r) => r.reportsKey)).toEqual(['key-from-input']);
    });

    it('refuses an input credential that would inject a header, and a missing one', async () => {
      const { tool } = await startAdapter({ securitySchemesInInput: ['ReportsKey'] }, reportsOnlySpec(baseUrl));

      await expect(tool('weeklyReport')({ ReportsKey: 'key\r\nX-Admin: 1' }, callerContext)).rejects.toThrow(
        /control characters/,
      );
      await expect(tool('weeklyReport')({}, callerContext)).rejects.toThrow(
        /Authentication required for tool 'weeklyReport'/,
      );
      expect(received).toHaveLength(0);
    });
  });
});
