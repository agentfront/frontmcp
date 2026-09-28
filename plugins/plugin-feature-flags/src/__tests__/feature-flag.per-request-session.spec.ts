/**
 * Flags are never evaluated for a session id the server made up for one request.
 *
 * Under MCP 2026-07-28 (and on the stateless web transport) the server mints a new session id for
 * every request of a static-key or anonymous caller. It counted as the verified session, so the
 * adapter saw a different session on every request, and a session-targeted rollout (LaunchDarkly and
 * Split.io key on the session when there is no user) flipped from one request to the next.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import FeatureFlagPlugin from '../feature-flag.plugin';
import type { FeatureFlagContext } from '../feature-flag.types';

/** Records every evaluation context, and turns every flag on. */
class RecordingAdapter implements FeatureFlagAdapter {
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
    return new Map(flagKeys.map((key) => [key, true]));
  }

  async destroy(): Promise<void> {
    // nothing to release
  }
}

@Tool({ name: 'beta_export', inputSchema: {}, featureFlag: 'beta-export' })
class BetaExportTool extends ToolContext {
  async execute() {
    return { exported: true };
  }
}

const STATIC_KEY = 'sk-lab-static-key-0001';

function config(adapter: RecordingAdapter, withStaticKey = true): FrontMcpConfigInput {
  @App({
    id: 'lab',
    name: 'Lab',
    plugins: [FeatureFlagPlugin.init({ adapter: 'custom', adapterInstance: adapter })],
    tools: [BetaExportTool],
  })
  class LabApp {}
  return {
    info: { name: 'feature-flag-per-request-session', version: '1.0.0' },
    apps: [LabApp],
    ...(withStaticKey ? { auth: { mode: 'static' as const, tokens: [STATIC_KEY] } } : {}),
    logging: { level: LogLevel.Off },
  };
}

type Handler = (request: Request) => Promise<Response>;

function call(handler: Handler, protocol: '2026-07-28' | '2025-06-18', key?: string): Promise<Response> {
  const is2026 = protocol === '2026-07-28';
  return handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        'mcp-protocol-version': protocol,
        ...(is2026 ? { 'mcp-method': 'tools/call', 'mcp-name': 'beta_export' } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'beta_export',
          arguments: {},
          ...(is2026
            ? {
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': protocol,
                  'io.modelcontextprotocol/clientInfo': { name: 'feature-flag-spec', version: '1.0.0' },
                  'io.modelcontextprotocol/clientCapabilities': {},
                },
              }
            : {}),
        },
      }),
    }),
  );
}

describe.each([['2026-07-28'], ['2025-06-18']] as const)(
  'a static-key caller without a session (protocol %s)',
  (protocol) => {
    it('is evaluated for its key, with no session id, on every request', async () => {
      const adapter = new RecordingAdapter();
      const handler = await FrontMcpInstance.createFetchHandler(config(adapter));

      await (await call(handler, protocol, STATIC_KEY)).text();
      await (await call(handler, protocol, STATIC_KEY)).text();

      expect(adapter.contexts.length).toBeGreaterThan(1);
      expect(adapter.contexts.map((context) => context.sessionId)).toEqual(adapter.contexts.map(() => undefined));
      expect(new Set(adapter.contexts.map((context) => context.userId)).size).toBe(1);
      expect(adapter.contexts[0]?.userId).toMatch(/^static:/);
    });
  },
);

describe.each([['2026-07-28'], ['2025-06-18']] as const)(
  'an anonymous caller without a session (protocol %s)',
  (protocol) => {
    it('is evaluated as nobody in particular, not as a user made up for the request', async () => {
      const adapter = new RecordingAdapter();
      const handler = await FrontMcpInstance.createFetchHandler(config(adapter, false));

      await (await call(handler, protocol)).text();
      await (await call(handler, protocol)).text();

      expect(adapter.contexts.length).toBeGreaterThan(1);
      expect(adapter.contexts.map(({ userId, sessionId }) => ({ userId, sessionId }))).toEqual(
        adapter.contexts.map(() => ({ userId: undefined, sessionId: undefined })),
      );
    });
  },
);
