/**
 * Verifies that `FrontMcpInstance` populates `CloudBootstrapContext.registries`
 * with handles to the primary scope's tool/resource/prompt/agent registries
 * when the cloud provider's `bootstrap()` runs.
 */

import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import type { CloudBootstrapContext, CloudProvider } from '../../common/types/options/cloud/provider';

const capturedCtx: { value?: CloudBootstrapContext } = {};

const testCloudProvider: CloudProvider = {
  name: 'test-cloud',
  contribute: jest.fn().mockReturnValue(undefined),
  bootstrap: jest.fn(async (ctx: CloudBootstrapContext) => {
    capturedCtx.value = ctx;
  }),
};

jest.mock('../../scope/cloud-autoload', () => {
  const actual = jest.requireActual('../../scope/cloud-autoload');
  return {
    ...actual,
    loadCloudProvider: jest.fn((cloud: unknown) => {
      if (!cloud || typeof cloud !== 'object' || Object.keys(cloud as object).length === 0) return undefined;
      return { provider: testCloudProvider, contributions: undefined };
    }),
  };
});

@Tool({
  name: 'echo',
  description: 'echoes its input',
  inputSchema: { message: z.string() },
})
class EchoTool extends ToolContext {
  async execute(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    return { content: [{ type: 'text', text: 'ok' }] };
  }
}

describe('FrontMcpInstance cloud bootstrap registries wiring', () => {
  beforeEach(() => {
    capturedCtx.value = undefined;
    (testCloudProvider.bootstrap as jest.Mock).mockClear();
  });

  async function createInstance() {
    const { FrontMcpInstance } = await import('../front-mcp');
    return FrontMcpInstance.createForGraph({
      info: { name: 'cloud-registries-test', version: '0.0.0' },
      apps: [],
      tools: [EchoTool],
      cloud: { clientId: 'test-client', secret: 'test-secret' },
      serve: false,
    } as unknown as Parameters<typeof FrontMcpInstance.createForGraph>[0]);
  }

  it('passes primary-scope registries to cloud bootstrap', async () => {
    await createInstance();

    expect(testCloudProvider.bootstrap).toHaveBeenCalledTimes(1);
    expect(capturedCtx.value).toBeDefined();
    expect(capturedCtx.value?.registries).toBeDefined();

    const { registries } = capturedCtx.value!;
    expect(typeof registries!.tools.listAllInstances).toBe('function');
    expect(typeof registries!.tools.subscribe).toBe('function');
    expect(typeof registries!.resources.listAllInstances).toBe('function');
    expect(typeof registries!.resources.subscribe).toBe('function');
    expect(typeof registries!.prompts.listAllInstances).toBe('function');
    expect(typeof registries!.prompts.subscribe).toBe('function');
    expect(typeof registries!.agents.listAllInstances).toBe('function');
    expect(typeof registries!.agents.subscribe).toBe('function');
  });

  it('returns readonly arrays from listAllInstances for all four registries', async () => {
    await createInstance();

    const { registries } = capturedCtx.value!;
    expect(Array.isArray(registries!.tools.listAllInstances())).toBe(true);
    expect(Array.isArray(registries!.resources.listAllInstances())).toBe(true);
    expect(Array.isArray(registries!.prompts.listAllInstances())).toBe(true);
    expect(Array.isArray(registries!.agents.listAllInstances())).toBe(true);
  });

  it('fires an immediate reset event on subscribe for seeding initial sync', async () => {
    await createInstance();

    const events: Array<{ kind: string; snapshotIsArray: boolean }> = [];
    const unsubscribe = capturedCtx.value!.registries!.tools.subscribe({ immediate: true }, (evt) => {
      events.push({ kind: evt.kind, snapshotIsArray: Array.isArray(evt.snapshot) });
    });

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('reset');
    expect(events[0].snapshotIsArray).toBe(true);

    unsubscribe();
  });

  it('fires immediate reset events for resources, prompts, and agents registries too', async () => {
    await createInstance();

    const resourceKinds: string[] = [];
    const promptKinds: string[] = [];
    const agentKinds: string[] = [];

    const unsubRes = capturedCtx.value!.registries!.resources.subscribe({ immediate: true }, (e) =>
      resourceKinds.push(e.kind),
    );
    const unsubProm = capturedCtx.value!.registries!.prompts.subscribe({ immediate: true }, (e) =>
      promptKinds.push(e.kind),
    );
    const unsubAg = capturedCtx.value!.registries!.agents.subscribe({ immediate: true }, (e) =>
      agentKinds.push(e.kind),
    );

    expect(resourceKinds).toEqual(['reset']);
    expect(promptKinds).toEqual(['reset']);
    expect(agentKinds).toEqual(['reset']);

    unsubRes();
    unsubProm();
    unsubAg();
  });
});
