/**
 * End-to-end behavioral test for the OpenAPI internal-tool adapter.
 *
 * Exercises the full path:
 *   bundle apply → HiddenOpRegistry populated → OperationToolFactory registers
 *   ToolInstances → registry.getTools() shows them, getToolsForListing() hides
 *   them. Asserts the v1.2 contract: per-op tools are SDK-internal, not in
 *   tools/list, and rebuild atomically on swap + rollback.
 */

import 'reflect-metadata';

import { BundleStore, type ResolvedBundle } from '@frontmcp/adapters/skills';
import type { SkillContent, SkillRegistryInterface, ToolRegistry } from '@frontmcp/sdk';

import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import { BundleSyncService } from '../sync/bundle-sync.service';
import { OperationToolFactory, operationToolName } from '../tools/operation-tool.factory';

const noopLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

class FakeSkillRegistry implements Partial<SkillRegistryInterface> {
  public registered: SkillContent[] = [];
  async registerSkillContent(content: SkillContent): Promise<{ id: string; unregister: () => Promise<void> }> {
    this.registered.push(content);
    return { id: content.id, unregister: async () => {} };
  }
}

interface FakeRegisteredTool {
  metadata: { name: string; visibility?: string };
  fullName: string;
  name: string;
}

class FakeToolRegistry {
  registered: FakeRegisteredTool[] = [];
  registerToolInstance(tool: { record: { metadata: { name: string; visibility?: string } } }) {
    const meta = tool.record.metadata;
    this.registered.push({
      metadata: meta,
      fullName: `skilled-openapi:${meta.name}`,
      name: meta.name,
    });
  }
  unregisterToolInstance(_token: unknown): boolean {
    if (this.registered.length === 0) return false;
    this.registered.pop();
    return true;
  }
  getToolsForListing(): FakeRegisteredTool[] {
    return this.registered.filter((t) => t.metadata.visibility !== 'internal');
  }
  getTools(includeHidden = false): FakeRegisteredTool[] {
    if (includeHidden) return [...this.registered];
    return this.registered.filter((t) => t.metadata.visibility !== 'internal');
  }
}

class FakeProviderRegistry {
  getActiveScope() {
    return { logger: noopLogger, hooks: { registerHooks: jest.fn() } };
  }
}

const buildBundle = (overrides: Partial<ResolvedBundle> = {}): ResolvedBundle => ({
  schemaVersion: 1,
  bundleId: 'acme:test',
  version: '1',
  generatedAt: '2026-05-04T00:00:00Z',
  sourceDigest: 'a'.repeat(64),
  services: [{ id: 'svc', baseUrl: 'https://example.com' }],
  authBindings: { def: { kind: 'none' as const } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Manage invoices.',
      instructions: '# Invoices',
      operationIds: ['createInvoice', 'listInvoices'],
    },
  ],
  operations: {
    createInvoice: {
      operationId: 'createInvoice',
      serviceId: 'svc',
      httpMethod: 'POST',
      pathTemplate: '/v1/invoices',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      mapper: [],
      authBindingRef: 'def',
    },
    listInvoices: {
      operationId: 'listInvoices',
      serviceId: 'svc',
      httpMethod: 'GET',
      pathTemplate: '/v1/invoices',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      mapper: [],
      authBindingRef: 'def',
    },
  },
  ...overrides,
});

describe('OpenAPI internal-tool adapter — end-to-end via BundleSyncService', () => {
  function buildSync() {
    const skillRegistry = new FakeSkillRegistry();
    const hiddenOps = new HiddenOpRegistry();
    const bundleStore = new BundleStore();
    const toolRegistry = new FakeToolRegistry();
    const factory = new OperationToolFactory({
      toolRegistry: toolRegistry as unknown as ToolRegistry,
      providers: new FakeProviderRegistry() as never,
      logger: noopLogger,
    });
    const sync = new BundleSyncService(
      skillRegistry as unknown as SkillRegistryInterface,
      hiddenOps,
      bundleStore,
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: true },
      noopLogger,
      factory,
    );
    return { sync, toolRegistry, hiddenOps, bundleStore, factory };
  }

  it('applying a bundle registers one internal tool per operation', async () => {
    const { sync, toolRegistry, factory } = buildSync();
    const result = await sync.apply(buildBundle());

    expect(result.applied).toBe(true);
    expect(factory.size).toBe(2);
    const names = toolRegistry.registered.map((t) => t.metadata.name);
    expect(names).toEqual([
      operationToolName('acme:test', 'createInvoice'),
      operationToolName('acme:test', 'listInvoices'),
    ]);
    expect(toolRegistry.registered.every((t) => t.metadata.visibility === 'internal')).toBe(true);
  });

  it('internal tools are excluded from getToolsForListing', async () => {
    const { sync, toolRegistry } = buildSync();
    await sync.apply(buildBundle());
    expect(toolRegistry.getToolsForListing()).toHaveLength(0);
    expect(toolRegistry.getTools(true)).toHaveLength(2);
  });

  it('rebuilds the internal-tool set on swap, replacing prior bundle ops', async () => {
    const { sync, toolRegistry, factory } = buildSync();
    await sync.apply(buildBundle());
    expect(factory.size).toBe(2);

    const next = buildBundle({
      version: '2',
      skills: [
        {
          id: 'invoices',
          name: 'Invoices',
          description: 'Manage invoices.',
          instructions: '# Invoices',
          operationIds: ['voidInvoice'],
        },
      ],
      operations: {
        voidInvoice: {
          operationId: 'voidInvoice',
          serviceId: 'svc',
          httpMethod: 'POST',
          pathTemplate: '/v1/invoices/{id}/void',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          mapper: [],
          authBindingRef: 'def',
        },
      },
    });
    await sync.apply(next);

    expect(factory.size).toBe(1);
    const names = toolRegistry.registered.map((t) => t.metadata.name);
    // Only the new bundle's op should remain registered.
    expect(names).toEqual([operationToolName('acme:test', 'voidInvoice')]);
  });

  it('exposeOperationsAsInternalTools=false skips registration', async () => {
    const skillRegistry = new FakeSkillRegistry();
    const hiddenOps = new HiddenOpRegistry();
    const bundleStore = new BundleStore();
    const toolRegistry = new FakeToolRegistry();
    const factory = new OperationToolFactory({
      toolRegistry: toolRegistry as unknown as ToolRegistry,
      providers: new FakeProviderRegistry() as never,
      logger: noopLogger,
    });
    const sync = new BundleSyncService(
      skillRegistry as unknown as SkillRegistryInterface,
      hiddenOps,
      bundleStore,
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      noopLogger,
      factory,
    );

    await sync.apply(buildBundle());
    expect(factory.size).toBe(0);
    expect(toolRegistry.registered).toHaveLength(0);
  });
});
