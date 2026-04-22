/**
 * Smoke test for `PromptRegistry.unregisterPromptInstance`.
 *
 * Mirrors the Phase-9 `tool.registry.unregister.spec.ts` harness: boots a
 * minimal scope with a single @Prompt + @App via FrontMcpInstance and
 * exercises the unregister API on the app's own PromptRegistry. Covers
 * the same contract surface — idempotent double-call, `removed` event,
 * token-path access, and unknown-token no-op.
 */

import 'reflect-metadata';

import type { GetPromptResult } from '@frontmcp/protocol';

import { App, Prompt, PromptContext } from '../../common';
import type { PromptChangeEvent } from '../prompt.events';

@Prompt({
  name: 'demo_unreg_prompt',
  description: 'demo prompt for the unregister smoke test',
  arguments: [],
})
class DemoPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return {
      messages: [{ role: 'user', content: { type: 'text', text: 'ok' } }],
    };
  }
}

@App({
  name: 'demo-unreg-prompt-app',
  description: 'app wrapping the demo prompt for the unregister smoke test',
  prompts: [DemoPrompt],
})
class DemoApp {}

interface PromptLike {
  metadata: { name: string };
  record: { provide: unknown };
}

interface RegistryLike {
  listAllInstances(): PromptLike[];
  unregisterPromptInstance(entryOrToken: unknown): boolean;
  subscribe(opts: { immediate?: boolean }, cb: (evt: PromptChangeEvent) => void): () => void;
}

async function bootAppRegistry(): Promise<RegistryLike> {
  const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'prompt-unregister-test', version: '0.0.0' },
    apps: [DemoApp],
    serve: false,
  } as unknown as Parameters<typeof FrontMcpInstance.createForGraph>[0]);
  const [scope] = instance.getScopes();
  // The app's own PromptRegistry is where registerPromptInstance landed
  // the entry. Scope-level adoption doesn't hold the direct `instances`
  // map these tests assert on.
  const apps = (
    scope as unknown as { apps: { getApps(): Array<{ metadata: { name: string }; prompts: unknown }> } }
  ).apps.getApps();
  const demoApp = apps.find((a) => a.metadata.name === 'demo-unreg-prompt-app');
  if (!demoApp) throw new Error('demo-unreg-prompt-app not contributed to scope');
  return demoApp.prompts as RegistryLike;
}

describe('PromptRegistry.unregisterPromptInstance', () => {
  it('removes a registered prompt from listAllInstances and returns true', async () => {
    const registry = await bootAppRegistry();

    const before = registry.listAllInstances().find((p) => p.metadata.name === 'demo_unreg_prompt');
    expect(before).toBeDefined();

    expect(registry.unregisterPromptInstance(before)).toBe(true);
    expect(registry.listAllInstances().find((p) => p.metadata.name === 'demo_unreg_prompt')).toBeUndefined();
  });

  it('returns false on a second call (idempotent)', async () => {
    const registry = await bootAppRegistry();
    const entry = registry.listAllInstances().find((p) => p.metadata.name === 'demo_unreg_prompt')!;
    expect(registry.unregisterPromptInstance(entry)).toBe(true);
    expect(registry.unregisterPromptInstance(entry)).toBe(false);
  });

  it("emits a 'removed' change event on successful unregister", async () => {
    const registry = await bootAppRegistry();

    const kinds: PromptChangeEvent['kind'][] = [];
    const unsubscribe = registry.subscribe({ immediate: false }, (evt) => kinds.push(evt.kind));
    try {
      const entry = registry.listAllInstances().find((p) => p.metadata.name === 'demo_unreg_prompt')!;
      registry.unregisterPromptInstance(entry);
      expect(kinds).toContain('removed');
    } finally {
      unsubscribe();
    }
  });

  it('accepts a token directly', async () => {
    const registry = await bootAppRegistry();
    const entry = registry.listAllInstances().find((p) => p.metadata.name === 'demo_unreg_prompt')!;
    const token = entry.record.provide;
    expect(registry.unregisterPromptInstance(token)).toBe(true);
    expect(registry.listAllInstances().find((p) => p.metadata.name === 'demo_unreg_prompt')).toBeUndefined();
  });

  it('returns false for an unknown token (safe no-op)', async () => {
    const registry = await bootAppRegistry();
    expect(registry.unregisterPromptInstance(Symbol('nonexistent-token'))).toBe(false);
  });
});
