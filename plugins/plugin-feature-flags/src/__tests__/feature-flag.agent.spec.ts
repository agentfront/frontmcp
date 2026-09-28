/**
 * `@Agent({ featureFlag })` gates the agent's `invoke_<agent>` tool: the agent is listed and called
 * only through that tool, and the plugin reads the flag from the tool's metadata.
 */
import 'reflect-metadata';

import { Agent, AgentContext, App, connect, LogLevel, type DirectClient } from '@frontmcp/sdk';

import FeatureFlagPlugin from '../feature-flag.plugin';

const runs: string[] = [];

const llmAdapter = {
  completion: jest.fn().mockResolvedValue({ content: 'done', finishReason: 'stop' }),
};

@Agent({
  name: 'beta_agent',
  description: 'Behind a flag that is on',
  inputSchema: {},
  llm: { adapter: llmAdapter },
  featureFlag: 'flag-on',
})
class BetaAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('beta_agent');
    return { ran: 'beta_agent' };
  }
}

@Agent({
  name: 'hidden_agent',
  description: 'Behind a flag that is off',
  inputSchema: {},
  llm: { adapter: llmAdapter },
  featureFlag: 'flag-off',
})
class HiddenAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('hidden_agent');
    return { ran: 'hidden_agent' };
  }
}

@App({
  id: 'flagged-agents',
  name: 'Flagged agents',
  plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: { 'flag-on': true, 'flag-off': false } })],
  agents: [BetaAgent, HiddenAgent],
})
class FlaggedAgentsApp {}

describe('FeatureFlagPlugin on an @Agent', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'feature-flag-agents', version: '1.0.0' },
      apps: [FlaggedAgentsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    runs.length = 0;
  });

  it('leaves an agent whose flag is off out of tools/list', async () => {
    const listing = JSON.stringify(await client.listTools());

    expect(listing).toContain('"invoke_beta_agent"');
    expect(listing).not.toContain('"invoke_hidden_agent"');
  });

  it('refuses tools/call on an agent whose flag is off', async () => {
    const result = JSON.stringify(await client.callTool('invoke_hidden_agent', {}));

    expect(result).toContain('"isError":true');
    expect(result).toContain('disabled by feature flag');
    expect(runs).toEqual([]);
  });

  it('runs an agent whose flag is on', async () => {
    const result = JSON.stringify(await client.callTool('invoke_beta_agent', {}));

    expect(result).toContain('beta_agent');
    expect(runs).toEqual(['beta_agent']);
  });
});
