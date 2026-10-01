/**
 * `this.featureFlags.isEnabled(key, defaultValue)` for a key the adapter has no answer for (#678).
 *
 * The docs make `defaultValue` the fallback "when the adapter throws or the flag is unknown", and
 * the execution gate already applied a ref's `defaultValue` to a key the adapter omits. The
 * accessor asked `adapter.isEnabled()`, which answers `false` for a key the static adapter was
 * never given, so `isEnabled('unknown', true)` was `false`: the default applied only when the
 * adapter threw.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import FeatureFlagPlugin from '../feature-flag.plugin';
import type { FeatureFlagPluginOptionsInput } from '../feature-flag.types';

const FLAGS = { 'flag-on': true, 'flag-off': false };

@Tool({
  name: 'check_flag',
  inputSchema: { key: z.string(), defaultValue: z.boolean().optional() },
})
class CheckFlagTool extends ToolContext {
  async execute({ key, defaultValue }: { key: string; defaultValue?: boolean }) {
    return { enabled: await this.featureFlags.isEnabled(key, defaultValue) };
  }
}

@Tool({
  name: 'resolve_ref',
  inputSchema: { key: z.string(), defaultValue: z.boolean() },
})
class ResolveRefTool extends ToolContext {
  async execute({ key, defaultValue }: { key: string; defaultValue: boolean }) {
    return { enabled: await this.featureFlags.resolveRef({ key, defaultValue }) };
  }
}

@Tool({ name: 'gated_fail_open', inputSchema: {}, featureFlag: { key: 'not-configured', defaultValue: true } })
class GatedFailOpenTool extends ToolContext {
  async execute() {
    return { ran: true };
  }
}

async function buildServer(options: FeatureFlagPluginOptionsInput): Promise<DirectMcpServer> {
  @App({
    id: 'flags',
    name: 'Flags',
    plugins: [FeatureFlagPlugin.init(options)],
    tools: [CheckFlagTool, ResolveRefTool, GatedFailOpenTool],
  })
  class FlagsApp {}

  return FrontMcpInstance.createDirect({
    info: { name: 'feature-flag-unknown-key', version: '1.0.0' },
    apps: [FlagsApp],
    logging: { level: LogLevel.Off },
  });
}

const caller = { authContext: { sessionId: 'session-flags', user: { sub: 'flags-caller' } } };

async function isEnabled(server: DirectMcpServer, key: string, defaultValue?: boolean): Promise<unknown> {
  const result = await server.callTool('check_flag', { key, defaultValue }, caller);
  return (result.structuredContent as { enabled?: unknown } | undefined)?.enabled;
}

describe('FeatureFlagPlugin — isEnabled(key, defaultValue) for an unknown key (#678)', () => {
  describe('with no plugin-level defaultValue', () => {
    let server: DirectMcpServer;

    beforeEach(async () => {
      server = await buildServer({ adapter: 'static', flags: FLAGS });
    });

    afterEach(async () => {
      await server.dispose();
    });

    it('answers the defaultValue for a key the adapter does not know', async () => {
      await expect(isEnabled(server, 'not-configured', true)).resolves.toBe(true);
      await expect(isEnabled(server, 'not-configured', false)).resolves.toBe(false);
    });

    it('answers false for an unknown key without a defaultValue', async () => {
      await expect(isEnabled(server, 'not-configured')).resolves.toBe(false);
    });

    it("keeps the adapter's answer for a known key, false included", async () => {
      await expect(isEnabled(server, 'flag-off', true)).resolves.toBe(false);
      await expect(isEnabled(server, 'flag-on', false)).resolves.toBe(true);
    });

    it('resolves an object ref the same way', async () => {
      const result = await server.callTool('resolve_ref', { key: 'not-configured', defaultValue: true }, caller);
      expect(result.structuredContent).toEqual({ enabled: true });
    });

    it('agrees with the execution gate', async () => {
      const gated = await server.callTool('gated_fail_open', {}, caller);

      expect(gated.structuredContent).toEqual({ ran: true });
      await expect(isEnabled(server, 'not-configured', true)).resolves.toBe(true);
    });
  });

  describe('with a plugin-level defaultValue', () => {
    let server: DirectMcpServer;

    beforeEach(async () => {
      server = await buildServer({ adapter: 'static', flags: FLAGS, defaultValue: true });
    });

    afterEach(async () => {
      await server.dispose();
    });

    it('falls back to it for an unknown key without a defaultValue', async () => {
      await expect(isEnabled(server, 'not-configured')).resolves.toBe(true);
    });

    it('lets the call defaultValue win over it', async () => {
      await expect(isEnabled(server, 'not-configured', false)).resolves.toBe(false);
    });
  });

  describe('with session caching', () => {
    let server: DirectMcpServer;

    beforeEach(async () => {
      server = await buildServer({ adapter: 'static', flags: FLAGS, cacheStrategy: 'session' });
    });

    afterEach(async () => {
      await server.dispose();
    });

    it("applies each call's defaultValue to a cached unknown key", async () => {
      await expect(isEnabled(server, 'not-configured', true)).resolves.toBe(true);
      await expect(isEnabled(server, 'not-configured', false)).resolves.toBe(false);
    });
  });
});
