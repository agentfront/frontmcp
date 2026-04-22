/**
 * Smoke test for `ToolRegistry.unregisterToolInstance`.
 *
 * Uses the `@FrontMcp()` + `@Tool()` harness to boot a minimal scope with
 * one tool, then exercises the new Phase-9 unregister API on the real
 * scope-level ToolRegistry. Verifies idempotency (double-unregister is a
 * no-op that returns `false`), registry-view changes (`listAllInstances`
 * drops the entry), and a `removed` subscription event.
 */

import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, FrontMcp, Tool, ToolContext } from '../../common';
import type { ToolChangeEvent } from '../tool.events';

@Tool({
  name: 'demo_unreg_tool',
  description: 'demo tool for the unregister smoke test',
  inputSchema: { message: z.string() },
})
class DemoTool extends ToolContext {
  async execute(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    return { content: [{ type: 'text', text: 'ok' }] };
  }
}

@App({
  name: 'demo-unreg-app',
  description: 'app wrapping the demo tool for the unregister smoke test',
  tools: [DemoTool],
})
class DemoApp {}

interface ToolLike {
  metadata: { name: string };
  record: { provide: unknown };
}

interface RegistryLike {
  listAllInstances(): ToolLike[];
  unregisterToolInstance(entryOrToken: unknown): boolean;
  subscribe(opts: { immediate?: boolean }, cb: (evt: ToolChangeEvent) => void): () => void;
}

async function bootAppRegistry(): Promise<RegistryLike> {
  const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'tool-unregister-test', version: '0.0.0' },
    apps: [DemoApp],
    serve: false,
  } as unknown as Parameters<typeof FrontMcpInstance.createForGraph>[0]);
  const [scope] = instance.getScopes();
  // The app's own tool registry is where `registerToolInstance` actually
  // landed the entry. The scope-level registry ADOPTS tools from it, but
  // the ownership + direct `instances` map live on the app.
  const apps = (
    scope as unknown as { apps: { getApps(): Array<{ metadata: { name: string }; tools: unknown }> } }
  ).apps.getApps();
  const demoApp = apps.find((a) => a.metadata.name === 'demo-unreg-app');
  if (!demoApp) throw new Error('demo-unreg-app not contributed to scope');
  return demoApp.tools as RegistryLike;
}

describe('ToolRegistry.unregisterToolInstance', () => {
  it('removes a registered tool from listAllInstances and returns true', async () => {
    const registry = await bootAppRegistry();

    const before = registry.listAllInstances().find((t) => t.metadata.name === 'demo_unreg_tool');
    expect(before).toBeDefined();

    expect(registry.unregisterToolInstance(before)).toBe(true);
    expect(registry.listAllInstances().find((t) => t.metadata.name === 'demo_unreg_tool')).toBeUndefined();
  });

  it('returns false on a second call (idempotent)', async () => {
    const registry = await bootAppRegistry();
    const entry = registry.listAllInstances().find((t) => t.metadata.name === 'demo_unreg_tool')!;
    expect(registry.unregisterToolInstance(entry)).toBe(true);
    expect(registry.unregisterToolInstance(entry)).toBe(false);
  });

  it("emits a 'removed' change event on successful unregister", async () => {
    const registry = await bootAppRegistry();

    const kinds: ToolChangeEvent['kind'][] = [];
    const unsubscribe = registry.subscribe({ immediate: false }, (evt) => kinds.push(evt.kind));
    try {
      const entry = registry.listAllInstances().find((t) => t.metadata.name === 'demo_unreg_tool')!;
      registry.unregisterToolInstance(entry);
      expect(kinds).toContain('removed');
    } finally {
      unsubscribe();
    }
  });

  it('accepts a token directly', async () => {
    const registry = await bootAppRegistry();
    const entry = registry.listAllInstances().find((t) => t.metadata.name === 'demo_unreg_tool')!;
    const token = entry.record.provide;
    expect(registry.unregisterToolInstance(token)).toBe(true);
    expect(registry.listAllInstances().find((t) => t.metadata.name === 'demo_unreg_tool')).toBeUndefined();
  });

  it('returns false for an unknown token (safe no-op)', async () => {
    const registry = await bootAppRegistry();
    expect(registry.unregisterToolInstance(Symbol('nonexistent-token'))).toBe(false);
  });
});
