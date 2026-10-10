/**
 * What a gate answers when the adapter throws or does not know its flag (#719).
 *
 * Gates fail closed: they use the ref's `defaultValue`, then the plugin's opt-in `gateDefaultValue`,
 * then `false`. The plugin's `defaultValue` stays the fallback of `this.featureFlags.isEnabled()`
 * only, so a plugin-wide `defaultValue: true` meant for accessor reads cannot open every gated entry
 * during a provider outage.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  FrontMcpInstance,
  LogLevel,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type DirectMcpServer,
  type GetPromptResult,
  type ReadResourceResult,
} from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import { FeatureFlagConfigurationError, FeatureFlagDisabledError } from '../feature-flag.errors';
import FeatureFlagPlugin from '../feature-flag.plugin';
import type { FeatureFlagPluginOptionsInput } from '../feature-flag.types';

const FLAGS = { 'flag-off': false };

@Tool({ name: 'unknown_flag_tool', inputSchema: {}, featureFlag: 'not-configured' })
class UnknownFlagTool extends ToolContext {
  async execute() {
    return { ran: 'unknown_flag_tool' };
  }
}

@Tool({ name: 'ref_open_tool', inputSchema: {}, featureFlag: { key: 'not-configured', defaultValue: true } })
class RefOpenTool extends ToolContext {
  async execute() {
    return { ran: 'ref_open_tool' };
  }
}

@Tool({ name: 'ref_closed_tool', inputSchema: {}, featureFlag: { key: 'not-configured', defaultValue: false } })
class RefClosedTool extends ToolContext {
  async execute() {
    return { ran: 'ref_closed_tool' };
  }
}

@Tool({ name: 'disabled_tool', inputSchema: {}, featureFlag: 'flag-off' })
class DisabledTool extends ToolContext {
  async execute() {
    return { ran: 'disabled_tool' };
  }
}

@Tool({ name: 'check_flag', inputSchema: { key: z.string() } })
class CheckFlagTool extends ToolContext {
  async execute({ key }: { key: string }) {
    return { enabled: await this.featureFlags.isEnabled(key) };
  }
}

@Resource({ name: 'unknown-flag-resource', uri: 'flags://unknown', featureFlag: 'not-configured' })
class UnknownFlagResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'unknown-flag-resource' }] };
  }
}

@Prompt({ name: 'unknown-flag-prompt', arguments: [], featureFlag: 'not-configured' })
class UnknownFlagPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'unknown-flag-prompt' } }] };
  }
}

/** An adapter whose flag service is down: every evaluation throws. */
function failingAdapter(): FeatureFlagAdapter {
  const down = () => Promise.reject(new Error('flag service unavailable'));
  return { isEnabled: down, getVariant: down, evaluateFlags: down };
}

async function buildServer(options: FeatureFlagPluginOptionsInput): Promise<DirectMcpServer> {
  @App({
    id: 'gate-defaults',
    name: 'Gate defaults',
    plugins: [FeatureFlagPlugin.init(options)],
    tools: [UnknownFlagTool, RefOpenTool, RefClosedTool, DisabledTool, CheckFlagTool],
    resources: [UnknownFlagResource],
    prompts: [UnknownFlagPrompt],
  })
  class GateDefaultsApp {}

  return FrontMcpInstance.createDirect({
    info: { name: 'feature-flag-gate-defaults', version: '1.0.0' },
    apps: [GateDefaultsApp],
    logging: { level: LogLevel.Off },
  });
}

const caller = { authContext: { sessionId: 'session-gates', user: { sub: 'gates-caller' } } };

/** Whether the named tool ran, or the gate refused it with `FeatureFlagDisabledError`. */
async function callGated(server: DirectMcpServer, name: string): Promise<'ran' | 'refused'> {
  try {
    const result = await server.callTool(name, {}, caller);
    expect(result.structuredContent).toEqual({ ran: name });
    return 'ran';
  } catch (error) {
    expect(error).toBeInstanceOf(FeatureFlagDisabledError);
    return 'refused';
  }
}

async function listedTools(server: DirectMcpServer): Promise<string[]> {
  const { tools } = await server.listTools(caller);
  return tools.map((tool) => tool.name);
}

async function isEnabled(server: DirectMcpServer, key: string): Promise<unknown> {
  const result = await server.callTool('check_flag', { key }, caller);
  return (result.structuredContent as { enabled?: unknown } | undefined)?.enabled;
}

describe('FeatureFlagPlugin — gate defaults (#719)', () => {
  describe('with no gateDefaultValue', () => {
    let server: DirectMcpServer;

    beforeAll(async () => {
      server = await buildServer({ adapter: 'static', flags: FLAGS });
    });

    afterAll(async () => {
      await server.dispose();
    });

    it('fails closed for a string ref the adapter does not know', async () => {
      await expect(callGated(server, 'unknown_flag_tool')).resolves.toBe('refused');
      expect(await listedTools(server)).not.toContain('unknown_flag_tool');
    });

    it("uses the ref's defaultValue for a flag the adapter does not know", async () => {
      await expect(callGated(server, 'ref_open_tool')).resolves.toBe('ran');
      await expect(callGated(server, 'ref_closed_tool')).resolves.toBe('refused');
      expect(await listedTools(server)).toContain('ref_open_tool');
    });
  });

  describe('with a plugin defaultValue and no gateDefaultValue', () => {
    let server: DirectMcpServer;

    beforeAll(async () => {
      server = await buildServer({ adapter: 'static', flags: FLAGS, defaultValue: true });
    });

    afterAll(async () => {
      await server.dispose();
    });

    it('keeps the gates closed: the plugin defaultValue is for the accessor only', async () => {
      await expect(callGated(server, 'unknown_flag_tool')).resolves.toBe('refused');
      expect(await listedTools(server)).not.toContain('unknown_flag_tool');
    });

    it('still answers the accessor with it', async () => {
      await expect(isEnabled(server, 'not-configured')).resolves.toBe(true);
    });
  });

  describe('with gateDefaultValue: true', () => {
    let server: DirectMcpServer;

    beforeAll(async () => {
      server = await buildServer({ adapter: 'static', flags: FLAGS, gateDefaultValue: true });
    });

    afterAll(async () => {
      await server.dispose();
    });

    it('opens the gate for a string ref the adapter does not know, in the listing and on the call', async () => {
      expect(await listedTools(server)).toContain('unknown_flag_tool');
      await expect(callGated(server, 'unknown_flag_tool')).resolves.toBe('ran');
    });

    it('opens the resource and prompt gates the same way', async () => {
      const read = await server.readResource('flags://unknown', caller);
      expect(JSON.stringify(read)).toContain('unknown-flag-resource');

      const prompt = await server.getPrompt('unknown-flag-prompt', {}, caller);
      expect(JSON.stringify(prompt)).toContain('unknown-flag-prompt');
    });

    it("lets a ref's defaultValue win over it", async () => {
      await expect(callGated(server, 'ref_closed_tool')).resolves.toBe('refused');
      expect(await listedTools(server)).not.toContain('ref_closed_tool');
    });

    it("keeps the adapter's answer for a flag it knows, false included", async () => {
      await expect(callGated(server, 'disabled_tool')).resolves.toBe('refused');
      expect(await listedTools(server)).not.toContain('disabled_tool');
    });

    it('leaves the accessor on its own fallback: call, then plugin defaultValue, then false', async () => {
      await expect(isEnabled(server, 'not-configured')).resolves.toBe(false);
    });
  });

  describe('when the adapter throws', () => {
    it('answers the gate with gateDefaultValue', async () => {
      const server = await buildServer({
        adapter: 'custom',
        adapterInstance: failingAdapter(),
        gateDefaultValue: true,
      });
      try {
        await expect(callGated(server, 'unknown_flag_tool')).resolves.toBe('ran');
        await expect(callGated(server, 'ref_closed_tool')).resolves.toBe('refused');
      } finally {
        await server.dispose();
      }
    });

    it("answers the gate with the ref's defaultValue, then false, without gateDefaultValue", async () => {
      const server = await buildServer({ adapter: 'custom', adapterInstance: failingAdapter(), defaultValue: true });
      try {
        await expect(callGated(server, 'ref_open_tool')).resolves.toBe('ran');
        await expect(callGated(server, 'unknown_flag_tool')).resolves.toBe('refused');
      } finally {
        await server.dispose();
      }
    });
  });

  describe('option validation', () => {
    it('rejects a gateDefaultValue that is not a boolean', () => {
      const options = { adapter: 'static', flags: {}, gateDefaultValue: 'yes' } as unknown as Parameters<
        typeof FeatureFlagPlugin.init
      >[0];

      expect(() => FeatureFlagPlugin.init(options)).toThrow(FeatureFlagConfigurationError);
      expect(() => FeatureFlagPlugin.init(options)).toThrow(/`gateDefaultValue` must be a boolean, got "yes"/);
    });

    it('accepts a boolean gateDefaultValue', () => {
      expect(() => FeatureFlagPlugin.init({ adapter: 'static', flags: {}, gateDefaultValue: false })).not.toThrow();
    });
  });
});
