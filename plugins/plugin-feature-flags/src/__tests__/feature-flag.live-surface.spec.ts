/**
 * A flag flip the adapter reports updates the lists and sends a coalesced `list_changed`, for entries gated by
 * `featureFlag` and for entries whose `enabled` is a `featureFlagSource()`.
 */
import 'reflect-metadata';

import {
  App,
  connect,
  LogLevel,
  Prompt,
  PromptContext,
  Tool,
  ToolContext,
  type CallToolResult,
  type DirectClient,
  type GetPromptResult,
} from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import FeatureFlagPlugin from '../feature-flag.plugin';
import { featureFlagSource } from '../feature-flag.source';

class FlippableAdapter implements FeatureFlagAdapter {
  readonly flags: Record<string, boolean> = { beta: true };
  private readonly listeners = new Set<() => void>();

  async isEnabled(key: string): Promise<boolean> {
    return this.flags[key] === true;
  }

  async getVariant(key: string) {
    return { name: String(this.flags[key]), value: this.flags[key], enabled: this.flags[key] === true };
  }

  async evaluateFlags(keys: string[]): Promise<Map<string, boolean>> {
    return new Map(keys.filter((key) => key in this.flags).map((key) => [key, this.flags[key]]));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get followers(): number {
    return this.listeners.size;
  }

  flip(key: string, on: boolean): void {
    this.flags[key] = on;
    for (const listener of [...this.listeners]) listener();
  }
}

const adapter = new FlippableAdapter();

@Tool({ name: 'beta_tool', inputSchema: {}, featureFlag: 'beta' })
class BetaTool extends ToolContext {
  async execute() {
    return { ran: 'beta_tool' };
  }
}

@Tool({ name: 'beta_source_tool', inputSchema: {}, enabled: featureFlagSource(adapter, 'beta') })
class BetaSourceTool extends ToolContext {
  async execute() {
    return { ran: 'beta_source_tool' };
  }
}

@Prompt({ name: 'beta-prompt', arguments: [], featureFlag: 'beta' })
class BetaPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'beta' } }] };
  }
}

@App({
  id: 'beta',
  name: 'Beta',
  tools: [BetaTool, BetaSourceTool],
  prompts: [BetaPrompt],
  plugins: [FeatureFlagPlugin.init({ adapter: 'custom', adapterInstance: adapter })],
})
class BetaApp {}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('FeatureFlagPlugin on a live surface', () => {
  let client: DirectClient;
  const notifications: string[] = [];

  beforeAll(async () => {
    client = await connect({
      info: { name: 'flags', version: '1.0.0' },
      apps: [BetaApp],
      logging: { level: LogLevel.Off },
    });
    client.onNotification(({ method }) => notifications.push(method));
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    adapter.flip('beta', true);
    await pause(150);
    notifications.length = 0;
  });

  const toolNames = async () => ((await client.listTools()) as Array<{ name: string }>).map(({ name }) => name);

  it('sends list_changed once per flagged list when a flag flips', async () => {
    adapter.flip('beta', false);
    adapter.flip('beta', true);
    adapter.flip('beta', false);
    await pause(250);

    expect(notifications.filter((method) => method === 'notifications/tools/list_changed')).toHaveLength(1);
    expect(notifications.filter((method) => method === 'notifications/prompts/list_changed')).toHaveLength(1);
    expect(notifications).not.toContain('notifications/resources/list_changed');
  });

  it('lists what the flag allows now', async () => {
    expect(await toolNames()).toEqual(expect.arrayContaining(['beta_tool', 'beta_source_tool']));

    adapter.flip('beta', false);

    expect(await toolNames()).toEqual([]);
    expect((await client.listPrompts()).prompts).toEqual([]);
  });

  it('refuses a tool whose enabled is a flag source with FEATURE_OFF and the flag to turn on', async () => {
    adapter.flip('beta', false);
    await pause(150);
    await toolNames();

    const result = (await client.callTool('beta_source_tool', {})) as CallToolResult;

    expect(result._meta).toMatchObject({ code: 'FEATURE_OFF', remedy: { say: 'Turn on the feature flag "beta".' } });
  });

  it('keeps refusing a tool gated by featureFlag with FEATURE_FLAG_DISABLED', async () => {
    adapter.flip('beta', false);
    await pause(150);
    await toolNames();

    const result = (await client.callTool('beta_tool', {})) as CallToolResult;

    expect(result._meta).toMatchObject({ code: 'FEATURE_FLAG_DISABLED' });
  });

  it('stops following the adapter once the server is disposed', async () => {
    const before = adapter.followers;
    const other = await connect({
      info: { name: 'flags-2', version: '1.0.0' },
      apps: [BetaApp],
      logging: { level: LogLevel.Off },
    });
    expect(adapter.followers).toBeGreaterThan(before);

    await other.close();

    expect(adapter.followers).toBe(before);
  });
});
