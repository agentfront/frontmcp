/**
 * A misconfigured server fails where it is created, through `createFetchHandler()` as through
 * `createDirect()`.
 *
 * The startup checks refuse a server whose entries ask for protection nothing gives them: an
 * `approval` or `featureFlag` field no installed plugin enforces, or `authorities` on a server
 * without the `authorities` option. `createDirect()` rejects such a server, but
 * `createFetchHandler()` deferred the whole build to the first request and returned a handler
 * whose requests threw.
 *
 * On an edge isolate (Cloudflare Workers, Vercel Edge, Deno) the server still can't be built where
 * the handler is created: module evaluation forbids timers, randomness and I/O, and a Worker's
 * secrets arrive with its first request. There, what the config's metadata alone shows is refused
 * at creation, and a check that needs the built server answers every request with a structured
 * `server_misconfigured` error.
 */
import 'reflect-metadata';

import {
  Agent,
  AgentContext,
  App,
  FlowHooksOf,
  LogLevel,
  Plugin,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
} from '../../common';
import { connect } from '../../direct';
import { AuthConfigurationError, UnenforcedMetadataError } from '../../errors';
import { FrontMcpInstance } from '../front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');

// The plugin fields are declared by the plugin packages' type augmentation, which these tests do not load.
const APPROVAL: Record<string, unknown> = { approval: true };
const BETA_FLAG: Record<string, unknown> = { featureFlag: 'beta' };

function tool(name: string, extra: Record<string, unknown> = {}) {
  @Tool({ name, inputSchema: {}, ...extra })
  class NamedTool extends ToolContext {
    async execute() {
      return { ok: true };
    }
  }
  return NamedTool;
}

@ResourceTemplate({ name: 'ticket', uriTemplate: 'tickets://{id}', mimeType: 'text/plain', authorities: 'admin' })
class TicketTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'secret' }] };
  }
}

/** Enforces `approval` on the tools of the app it is installed on. */
@Plugin({ name: 'desk-approval', enforcesMetadata: ['approval'] })
class DeskApprovalPlugin {
  @ToolHook.Will('execute')
  gate() {
    // enforcement itself is not under test here
  }
}

const llm = { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } };

/** Its tool asks for approval, and only a plugin on the agent reaches the agent's own tools. */
@Agent({ name: 'triage', inputSchema: {}, llm, tools: [tool('close_ticket', APPROVAL)] })
class TriageAgent extends AgentContext {}

function serverWith(app: Record<string, unknown>): FrontMcpConfigInput {
  @App({ id: 'desk', name: 'Desk', ...app })
  class DeskApp {}
  return { info: { name: 'fetch-startup', version: '1.0.0' }, apps: [DeskApp], logging: { level: LogLevel.Off } };
}

/** Misconfigurations the config's metadata alone shows. */
const MISCONFIGURED: Array<[string, FrontMcpConfigInput, new (...args: never[]) => Error]> = [
  ['a tool declares approval', serverWith({ tools: [tool('refund_invoice', APPROVAL)] }), UnenforcedMetadataError],
  ['a tool declares a feature flag', serverWith({ tools: [tool('bulk_export', BETA_FLAG)] }), UnenforcedMetadataError],
  ['a resource template declares authorities', serverWith({ resources: [TicketTemplate] }), AuthConfigurationError],
  [
    'a tool of an agent asks for approval, and the plugin that enforces it is on the app, not the agent',
    serverWith({ agents: [TriageAgent], plugins: [DeskApprovalPlugin] }),
    UnenforcedMetadataError,
  ],
];

/** A tool asks for approval and no plugin enforces it, but only the process it runs in says it is served. */
const NEEDS_BUILT_SERVER = serverWith({
  tools: [tool('refund_in_tests', { ...APPROVAL, availableWhen: { env: ['test'] } })],
});

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/** Creates the handler as module code on an edge isolate does; the first request comes after. */
async function createOnEdge(config: FrontMcpConfigInput) {
  const globals = globalThis as Record<string, unknown>;
  globals['EdgeRuntime'] = 'edge-runtime';
  try {
    return await FrontMcpInstance.createFetchHandler(config);
  } finally {
    delete globals['EdgeRuntime'];
  }
}

function initialize(): Request {
  return new Request('https://desk.example.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1.0.0' } },
    }),
  });
}

describe('createFetchHandler() startup checks', () => {
  it.each(MISCONFIGURED)('refuses to create the handler when %s, as createDirect() refuses', async (_c, config, E) => {
    const direct = await rejectionOf(FrontMcpInstance.createDirect(config));
    const fetch = await rejectionOf(FrontMcpInstance.createFetchHandler(config));

    expect(direct).toBeInstanceOf(E);
    expect(fetch).toBeInstanceOf(E);
    expect((fetch as Error).message).toBe((direct as Error).message);
  });

  it.each(MISCONFIGURED)('connect() refuses too when %s', async (_c, config, E) => {
    expect(await rejectionOf(connect(config))).toBeInstanceOf(E);
  });

  it('refuses a check that needs the built server too', async () => {
    const fetch = await rejectionOf(FrontMcpInstance.createFetchHandler(NEEDS_BUILT_SERVER));

    expect(fetch).toBeInstanceOf(UnenforcedMetadataError);
    expect((fetch as Error).message).toContain(`Tool "refund_in_tests" declares 'approval'`);
  });

  it('creates and serves a server that passes them', async () => {
    const handler = await FrontMcpInstance.createFetchHandler(serverWith({ tools: [tool('lookup')] }));

    expect((await handler(initialize())).status).toBe(200);
  });

  describe('on an edge isolate', () => {
    it.each(MISCONFIGURED)('refuses to create the handler when %s', async (_c, config, E) => {
      const direct = await rejectionOf(FrontMcpInstance.createDirect(config));
      const fetch = await rejectionOf(createOnEdge(config));

      expect(fetch).toBeInstanceOf(E);
      expect((fetch as Error).message).toBe((direct as Error).message);
    });

    it('answers every request with server_misconfigured when a check needs the built server', async () => {
      const handler = await createOnEdge(NEEDS_BUILT_SERVER);

      const answers: Array<{ status: number; body: Record<string, string> }> = [];
      for (let i = 0; i < 2; i++) {
        const response = await handler(initialize());
        answers.push({ status: response.status, body: (await response.json()) as Record<string, string> });
      }

      expect(answers.map(({ status, body }) => ({ status, error: body['error'], code: body['code'] }))).toEqual([
        { status: 500, error: 'server_misconfigured', code: 'UNENFORCED_METADATA' },
        { status: 500, error: 'server_misconfigured', code: 'UNENFORCED_METADATA' },
      ]);
    });

    it('builds a server that passes them on its first request', async () => {
      const handler = await createOnEdge(serverWith({ tools: [tool('lookup')] }));

      expect((await handler(initialize())).status).toBe(200);
    });
  });
});
