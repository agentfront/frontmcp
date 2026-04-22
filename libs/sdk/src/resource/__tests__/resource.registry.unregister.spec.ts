/**
 * Smoke test for `ResourceRegistry.unregisterResourceInstance`.
 *
 * Mirrors the Phase-9 `tool.registry.unregister.spec.ts` harness: boots a
 * minimal scope with a single @Resource + @App via FrontMcpInstance and
 * exercises the unregister API on the app's own ResourceRegistry. Covers
 * the same contract surface — idempotent double-call, `removed` event,
 * token-path access, and unknown-token no-op.
 */

import 'reflect-metadata';

import { App, Resource, ResourceContext } from '../../common';
import type { ResourceChangeEvent } from '../resource.events';

@Resource({
  name: 'demo_unreg_resource',
  description: 'demo resource for the unregister smoke test',
  uri: 'demo-unreg://resource',
})
class DemoResource extends ResourceContext {
  async execute(): Promise<{ contents: Array<{ uri: string; text: string }> }> {
    return { contents: [{ uri: this.uri, text: 'ok' }] };
  }
}

@App({
  name: 'demo-unreg-resource-app',
  description: 'app wrapping the demo resource for the unregister smoke test',
  resources: [DemoResource],
})
class DemoApp {}

interface ResourceLike {
  metadata: { name: string };
  record: { provide: unknown };
}

interface RegistryLike {
  listAllInstances(): ResourceLike[];
  unregisterResourceInstance(entryOrToken: unknown): boolean;
  subscribe(opts: { immediate?: boolean }, cb: (evt: ResourceChangeEvent) => void): () => void;
}

async function bootAppRegistry(): Promise<RegistryLike> {
  const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'resource-unregister-test', version: '0.0.0' },
    apps: [DemoApp],
    serve: false,
  } as unknown as Parameters<typeof FrontMcpInstance.createForGraph>[0]);
  const [scope] = instance.getScopes();
  // The app's own ResourceRegistry is where registerResourceInstance landed
  // the entry. Scope-level adoption doesn't hold the direct `instances` map
  // these tests assert on.
  const apps = (
    scope as unknown as { apps: { getApps(): Array<{ metadata: { name: string }; resources: unknown }> } }
  ).apps.getApps();
  const demoApp = apps.find((a) => a.metadata.name === 'demo-unreg-resource-app');
  if (!demoApp) throw new Error('demo-unreg-resource-app not contributed to scope');
  return demoApp.resources as RegistryLike;
}

describe('ResourceRegistry.unregisterResourceInstance', () => {
  it('removes a registered resource from listAllInstances and returns true', async () => {
    const registry = await bootAppRegistry();

    const before = registry.listAllInstances().find((r) => r.metadata.name === 'demo_unreg_resource');
    expect(before).toBeDefined();

    expect(registry.unregisterResourceInstance(before)).toBe(true);
    expect(registry.listAllInstances().find((r) => r.metadata.name === 'demo_unreg_resource')).toBeUndefined();
  });

  it('returns false on a second call (idempotent)', async () => {
    const registry = await bootAppRegistry();
    const entry = registry.listAllInstances().find((r) => r.metadata.name === 'demo_unreg_resource')!;
    expect(registry.unregisterResourceInstance(entry)).toBe(true);
    expect(registry.unregisterResourceInstance(entry)).toBe(false);
  });

  it("emits a 'removed' change event on successful unregister", async () => {
    const registry = await bootAppRegistry();

    const kinds: ResourceChangeEvent['kind'][] = [];
    const unsubscribe = registry.subscribe({ immediate: false }, (evt) => kinds.push(evt.kind));
    try {
      const entry = registry.listAllInstances().find((r) => r.metadata.name === 'demo_unreg_resource')!;
      registry.unregisterResourceInstance(entry);
      expect(kinds).toContain('removed');
    } finally {
      unsubscribe();
    }
  });

  it('accepts a token directly', async () => {
    const registry = await bootAppRegistry();
    const entry = registry.listAllInstances().find((r) => r.metadata.name === 'demo_unreg_resource')!;
    const token = entry.record.provide;
    expect(registry.unregisterResourceInstance(token)).toBe(true);
    expect(registry.listAllInstances().find((r) => r.metadata.name === 'demo_unreg_resource')).toBeUndefined();
  });

  it('returns false for an unknown token (safe no-op)', async () => {
    const registry = await bootAppRegistry();
    expect(registry.unregisterResourceInstance(Symbol('nonexistent-token'))).toBe(false);
  });
});
