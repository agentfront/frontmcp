/**
 * A custom adapter's `initialize()` runs before the server serves and its `destroy()` when the server
 * is disposed (#767). Up to 1.9.1 the plugin handed the instance over as is and called neither.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import FeatureFlagPlugin from '../feature-flag.plugin';

@Tool({ name: 'check_flag', inputSchema: { key: z.string() } })
class CheckFlagTool extends ToolContext {
  async execute({ key }: { key: string }) {
    return { enabled: await this.featureFlags.isEnabled(key) };
  }
}

async function buildServer(adapterInstance: Partial<FeatureFlagAdapter>): Promise<DirectMcpServer> {
  @App({
    id: 'flags',
    name: 'Flags',
    plugins: [FeatureFlagPlugin.init({ adapter: 'custom', adapterInstance: adapterInstance as FeatureFlagAdapter })],
    tools: [CheckFlagTool],
  })
  class FlagsApp {}

  return FrontMcpInstance.createDirect({
    info: { name: 'feature-flag-adapter-lifecycle', version: '1.0.0' },
    apps: [FlagsApp],
    logging: { level: LogLevel.Off },
  });
}

function recordingAdapter(events: string[]): FeatureFlagAdapter {
  let connected = false;
  return {
    async initialize() {
      events.push('initialize');
      connected = true;
    },
    async isEnabled() {
      return connected;
    },
    async getVariant(flagKey) {
      return { name: flagKey, value: undefined, enabled: connected };
    },
    async evaluateFlags(flagKeys) {
      return new Map(flagKeys.map((key) => [key, connected]));
    },
    async destroy() {
      events.push('destroy');
    },
  };
}

describe('FeatureFlagPlugin custom adapter lifecycle', () => {
  it('initializes and destroys one adapter once when one plugin record serves two apps', async () => {
    const events: string[] = [];
    const flagsPlugin = FeatureFlagPlugin.init({ adapter: 'custom', adapterInstance: recordingAdapter(events) });

    @App({ id: 'billing', name: 'Billing', plugins: [flagsPlugin], tools: [CheckFlagTool] })
    class BillingApp {}

    @App({ id: 'support', name: 'Support', plugins: [flagsPlugin], tools: [CheckFlagTool] })
    class SupportApp {}

    const server = await FrontMcpInstance.createDirect({
      info: { name: 'feature-flag-adapter-shared', version: '1.0.0' },
      apps: [BillingApp, SupportApp],
      logging: { level: LogLevel.Off },
    });
    expect(events).toEqual(['initialize']);

    await server.dispose();
    expect(events).toEqual(['initialize', 'destroy']);
  });

  it('initializes the adapter before the first call and destroys it on dispose', async () => {
    const events: string[] = [];
    const server = await buildServer(recordingAdapter(events));

    const result = await server.callTool('check_flag', { key: 'beta' });
    expect(result.structuredContent).toEqual({ enabled: true });
    expect(events).toEqual(['initialize']);

    await server.dispose();
    expect(events).toEqual(['initialize', 'destroy']);
  });

  it('accepts a custom adapter without initialize() or destroy()', async () => {
    const server = await buildServer({
      isEnabled: async () => true,
      getVariant: async (flagKey) => ({ name: flagKey, value: undefined, enabled: true }),
      evaluateFlags: async (flagKeys) => new Map(flagKeys.map((key) => [key, true])),
    });

    const result = await server.callTool('check_flag', { key: 'beta' });
    expect(result.structuredContent).toEqual({ enabled: true });
    await expect(server.dispose()).resolves.toBeUndefined();
  });
});
