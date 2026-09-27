/**
 * A list the feature-flag plugin filtered is never marked for a shared cache.
 *
 * MCP 2026-07-28 list results carry `cacheScope`, and anonymous results were marked `public`, so a
 * shared cache could serve one anonymous caller's list to every other one. With a rollout that
 * answers differently per caller (here, every other evaluation), two anonymous callers get
 * different `tools/list` results, and neither may be shared.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import FeatureFlagPlugin from '../feature-flag.plugin';
import type { FeatureFlagContext } from '../feature-flag.types';

const PROTOCOL = '2026-07-28';

/** A 50% rollout: `beta-export` is on for every other evaluation. */
class HalfRolloutAdapter implements FeatureFlagAdapter {
  private evaluations = 0;

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

  async evaluateFlags(flagKeys: string[], _context: FeatureFlagContext): Promise<Map<string, boolean>> {
    this.evaluations += 1;
    const enabled = this.evaluations % 2 === 1;
    return new Map(flagKeys.map((key) => [key, enabled]));
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

@Tool({ name: 'lookup_order', inputSchema: {} })
class LookupOrderTool extends ToolContext {
  async execute() {
    return { order: 'o-1' };
  }
}

async function listTools(handler: (request: Request) => Promise<Response>) {
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL,
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': PROTOCOL,
            'io.modelcontextprotocol/clientInfo': { name: 'feature-flag-spec', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  );
  const body = (await response.json()) as { result: { tools: Array<{ name: string }>; cacheScope?: string } };
  return { names: body.result.tools.map((tool) => tool.name), cacheScope: body.result.cacheScope };
}

describe('tools/list filtered by FeatureFlagPlugin for anonymous callers', () => {
  it('differs between callers, and is never marked public', async () => {
    @App({
      id: 'lab',
      name: 'Lab',
      plugins: [FeatureFlagPlugin.init({ adapter: 'custom', adapterInstance: new HalfRolloutAdapter() })],
      tools: [BetaExportTool, LookupOrderTool],
    })
    class LabApp {}
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'feature-flag-cache-scope', version: '1.0.0' },
      apps: [LabApp],
      logging: { level: LogLevel.Off },
    });

    const first = await listTools(handler);
    const second = await listTools(handler);

    expect(first.names).not.toEqual(second.names);
    expect([first.cacheScope, second.cacheScope]).toEqual(['private', 'private']);
  });
});
