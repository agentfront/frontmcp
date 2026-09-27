/**
 * Flags are evaluated for the session the server verified, never for a session id the caller
 * merely names.
 *
 * Under MCP 2026-07-28 a client may send any `mcp-session-id`; the server neither issued nor
 * verified it, yet `FrontMcpContext.sessionId` carries it. The plugin passed that value to the
 * adapter as the evaluation context's `sessionId`, which LaunchDarkly and Split.io also use as the
 * targeting key when there is no user. So a caller could name the session a rollout targets and
 * get a flagged-off tool listed and run.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import FeatureFlagPlugin from '../feature-flag.plugin';
import type { FeatureFlagContext } from '../feature-flag.types';

const PROTOCOL = '2026-07-28';
/** The session a rollout of `beta-export` targets. */
const TARGETED_SESSION = 'rollout-session-7f3a';

/** A session-targeted rollout: `beta-export` is on only for {@link TARGETED_SESSION}. */
class SessionRolloutAdapter implements FeatureFlagAdapter {
  readonly contexts: FeatureFlagContext[] = [];

  async initialize(): Promise<void> {
    // nothing to connect
  }

  async isEnabled(flagKey: string, context: FeatureFlagContext): Promise<boolean> {
    return (await this.evaluateFlags([flagKey], context)).get(flagKey) === true;
  }

  async getVariant(flagKey: string, context: FeatureFlagContext) {
    const enabled = await this.isEnabled(flagKey, context);
    return { name: enabled ? 'on' : 'off', value: enabled, enabled };
  }

  async evaluateFlags(flagKeys: string[], context: FeatureFlagContext): Promise<Map<string, boolean>> {
    this.contexts.push(context);
    return new Map(flagKeys.map((key) => [key, context.sessionId === TARGETED_SESSION]));
  }

  async destroy(): Promise<void> {
    // nothing to release
  }
}

const executed: string[] = [];

@Tool({ name: 'beta_export', inputSchema: {}, featureFlag: 'beta-export' })
class BetaExportTool extends ToolContext {
  async execute() {
    executed.push('beta_export');
    return { exported: true };
  }
}

function config(adapter: SessionRolloutAdapter): FrontMcpConfigInput {
  @App({
    id: 'lab',
    name: 'Lab',
    plugins: [FeatureFlagPlugin.init({ adapter: 'custom', adapterInstance: adapter })],
    tools: [BetaExportTool],
  })
  class LabApp {}
  return { info: { name: 'feature-flag-session', version: '1.0.0' }, apps: [LabApp], logging: { level: LogLevel.Off } };
}

async function rpc(
  handler: (request: Request) => Promise<Response>,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL,
        'mcp-method': method,
        ...(typeof params['name'] === 'string' ? { 'mcp-name': params['name'] } : {}),
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': PROTOCOL,
            'io.modelcontextprotocol/clientInfo': { name: 'feature-flag-spec', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  );
  return { status: response.status, body: await response.text() };
}

describe('a 2026-07-28 caller naming the targeted session', () => {
  let adapter: SessionRolloutAdapter;
  let handler: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    executed.length = 0;
    adapter = new SessionRolloutAdapter();
    handler = await FrontMcpInstance.createFetchHandler(config(adapter));
  });

  it('does not get the flagged tool listed', async () => {
    const { status, body } = await rpc(handler, 'tools/list', {}, { 'mcp-session-id': TARGETED_SESSION });

    expect(status).toBe(200);
    expect(body).toContain('"tools"');
    expect(body).not.toContain('"error"');
    expect(body).not.toContain('beta_export');
  });

  it('does not get the flagged tool run', async () => {
    const { body } = await rpc(
      handler,
      'tools/call',
      { name: 'beta_export', arguments: {} },
      { 'mcp-session-id': TARGETED_SESSION },
    );

    expect(executed).toEqual([]);
    expect(body).toContain('disabled by feature flag');
  });

  it('is never evaluated for the session it names', async () => {
    await rpc(handler, 'tools/list', {}, { 'mcp-session-id': TARGETED_SESSION });
    await rpc(handler, 'tools/call', { name: 'beta_export', arguments: {} }, { 'mcp-session-id': TARGETED_SESSION });

    expect(adapter.contexts.length).toBeGreaterThan(0);
    expect(adapter.contexts.map((context) => context.sessionId)).not.toContain(TARGETED_SESSION);
  });
});

describe('a caller whose session the server established', () => {
  it('is evaluated for that session', async () => {
    const adapter = new SessionRolloutAdapter();
    const server = await FrontMcpInstance.createDirect(config(adapter));
    try {
      await server.callTool('beta_export', {}, { authContext: { sessionId: TARGETED_SESSION } });

      expect(executed).toContain('beta_export');
      expect(adapter.contexts.length).toBeGreaterThan(0);
      expect(adapter.contexts.every((context) => context.sessionId === TARGETED_SESSION)).toBe(true);
    } finally {
      await server.dispose();
    }
  });
});
