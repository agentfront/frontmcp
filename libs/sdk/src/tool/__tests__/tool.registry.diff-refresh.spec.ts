/**
 * Integration smoke test for the Phase-9 diff-on-refresh pattern.
 *
 * `AppRemoteInstance.discoverAndRegisterCapabilities` uses a pure
 * `diffRemoved(previousTokens, nextTokens)` helper plus
 * `ToolRegistry.unregisterToolInstance` to prune stale entries between
 * capability refreshes. This spec wires those two pieces together against
 * a real scope-level ToolRegistry so the interaction is covered end-to-end
 * without the heavy remote-app boot machinery. It documents the exact
 * usage pattern expected of registry consumers (sync coordinators, MCP
 * gateways, etc.) when they own their own refresh cycle.
 */

import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { diffRemoved } from '../../app/instances/diff-remote-capabilities';
import { App, Tool, ToolContext } from '../../common';
import type { ToolChangeEvent } from '../tool.events';

@Tool({
  name: 'tool_alpha',
  description: 'alpha',
  inputSchema: { message: z.string() },
})
class ToolAlpha extends ToolContext {
  async execute(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    return { content: [{ type: 'text', text: 'alpha' }] };
  }
}

@Tool({
  name: 'tool_beta',
  description: 'beta',
  inputSchema: { message: z.string() },
})
class ToolBeta extends ToolContext {
  async execute(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    return { content: [{ type: 'text', text: 'beta' }] };
  }
}

@Tool({
  name: 'tool_gamma',
  description: 'gamma',
  inputSchema: { message: z.string() },
})
class ToolGamma extends ToolContext {
  async execute(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    return { content: [{ type: 'text', text: 'gamma' }] };
  }
}

@App({
  name: 'demo-diff-app',
  description: 'three tools to simulate a capability diff cycle',
  tools: [ToolAlpha, ToolBeta, ToolGamma],
})
class DemoApp {}

interface ToolLike {
  name: string;
  fullName?: string;
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
    info: { name: 'tool-diff-refresh-test', version: '0.0.0' },
    apps: [DemoApp],
    serve: false,
  } as unknown as Parameters<typeof FrontMcpInstance.createForGraph>[0]);
  const [scope] = instance.getScopes();
  const apps = (
    scope as unknown as { apps: { getApps(): Array<{ metadata: { name: string }; tools: unknown }> } }
  ).apps.getApps();
  const demoApp = apps.find((a) => a.metadata.name === 'demo-diff-app');
  if (!demoApp) throw new Error('demo-diff-app not contributed to scope');
  return demoApp.tools as RegistryLike;
}

/** Snapshot the registry as AppRemoteInstance does — keyed by fullName. */
function snapshot(registry: RegistryLike): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const entry of registry.listAllInstances()) {
    map.set(entry.fullName ?? entry.name, entry.record.provide);
  }
  return map;
}

describe('ToolRegistry diff-on-refresh pattern', () => {
  it('prunes exactly the entries missing from the next snapshot', async () => {
    const registry = await bootAppRegistry();

    // Previous refresh saw all three tools.
    const prev = snapshot(registry);
    expect(prev.size).toBe(3);

    // Simulated next refresh: the remote no longer advertises tool_beta.
    const next = new Map(prev);
    for (const key of next.keys()) {
      if (key.endsWith(':tool_beta') || key === 'tool_beta') next.delete(key);
    }
    expect(next.size).toBe(2);

    const removed = diffRemoved(prev, next);
    expect(removed).toHaveLength(1);
    const [[removedKey]] = removed;
    expect(removedKey.endsWith('tool_beta')).toBe(true);

    for (const [, token] of removed) {
      expect(registry.unregisterToolInstance(token)).toBe(true);
    }

    const remaining = registry
      .listAllInstances()
      .map((t) => t.metadata.name)
      .sort();
    expect(remaining).toEqual(['tool_alpha', 'tool_gamma']);
  });

  it('emits one removed event per unregistered entry', async () => {
    const registry = await bootAppRegistry();

    const removedEvents: ToolChangeEvent['kind'][] = [];
    const unsubscribe = registry.subscribe({ immediate: false }, (evt) => {
      if (evt.kind === 'removed') removedEvents.push(evt.kind);
    });
    try {
      const prev = snapshot(registry);
      const next = new Map<string, unknown>();
      for (const [key, token] of prev) {
        if (key.endsWith(':tool_alpha') || key === 'tool_alpha') next.set(key, token);
      }

      const removed = diffRemoved(prev, next);
      expect(removed).toHaveLength(2);
      for (const [, token] of removed) registry.unregisterToolInstance(token);

      expect(removedEvents).toHaveLength(2);
    } finally {
      unsubscribe();
    }
  });

  it('is a no-op when the next snapshot equals the previous one', async () => {
    const registry = await bootAppRegistry();

    const prev = snapshot(registry);
    const next = new Map(prev);

    const removed = diffRemoved(prev, next);
    expect(removed).toEqual([]);

    // Nothing unregistered → listAllInstances is unchanged.
    expect(registry.listAllInstances()).toHaveLength(3);
  });

  it('drains every entry when the next snapshot is empty', async () => {
    const registry = await bootAppRegistry();

    const prev = snapshot(registry);
    const next = new Map<string, unknown>();

    const removed = diffRemoved(prev, next);
    expect(removed).toHaveLength(3);
    for (const [, token] of removed) registry.unregisterToolInstance(token);

    expect(registry.listAllInstances()).toHaveLength(0);
  });
});
