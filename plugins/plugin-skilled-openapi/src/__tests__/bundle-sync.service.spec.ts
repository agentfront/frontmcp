import type { SkillContent, SkillRegistryInterface } from '@frontmcp/sdk';

import { BundleStore } from '../bundle/bundle.store';
import type { ResolvedBundle } from '../bundle/bundle.types';
import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import { BundleSyncService } from '../sync/bundle-sync.service';

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

class FakeRegistry implements Partial<SkillRegistryInterface> {
  public registered: SkillContent[] = [];
  public unregistered: string[] = [];
  public failNext = false;

  async registerSkillContent(content: SkillContent): Promise<{ id: string; unregister: () => Promise<void> }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('synthetic registration failure');
    }
    this.registered.push(content);
    return {
      id: content.id,
      unregister: async () => {
        this.unregistered.push(content.id);
      },
    };
  }
  async unregisterSkill(): Promise<boolean> {
    return false;
  }
}

const buildBundle = (overrides: Partial<ResolvedBundle> = {}): ResolvedBundle => ({
  schemaVersion: 1,
  bundleId: 'acme:prod',
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
      operationIds: ['createInvoice'],
    },
  ],
  operations: {
    createInvoice: {
      operationId: 'createInvoice',
      serviceId: 'svc',
      httpMethod: 'POST',
      pathTemplate: '/v1/invoices',
      inputSchema: {},
      outputSchema: {},
      mapper: [],
      authBindingRef: 'def',
    },
  },
  ...overrides,
});

describe('BundleSyncService', () => {
  it('applies a bundle: registers skills, populates hidden-op registry, swaps store', async () => {
    const fakeReg = new FakeRegistry();
    const hiddenOps = new HiddenOpRegistry();
    const store = new BundleStore();
    const sync = new BundleSyncService(
      fakeReg as unknown as SkillRegistryInterface,
      hiddenOps,
      store,
      { requireSignature: false, trustedKeys: [] },
      fakeLogger,
    );

    const bundle = buildBundle();
    const result = await sync.apply(bundle);

    expect(result.applied).toBe(true);
    expect(fakeReg.registered).toHaveLength(1);
    expect(fakeReg.registered[0].id).toBe('invoices');
    expect(fakeReg.registered[0].actions?.[0]?.actionId).toBe('createInvoice');
    expect(fakeReg.registered[0].bundleVersion).toBe('1');
    expect(hiddenOps.size).toBe(1);
    expect(hiddenOps.get('invoices', 'createInvoice')?.op.pathTemplate).toBe('/v1/invoices');
    expect(store.current()).toBe(bundle);
  });

  it('rejects bundles missing integrity when requireSignature=true', async () => {
    const fakeReg = new FakeRegistry();
    const sync = new BundleSyncService(
      fakeReg as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: true, trustedKeys: [] },
      fakeLogger,
    );
    const result = await sync.apply(buildBundle());
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/missing integrity/);
    expect(fakeReg.registered).toHaveLength(0);
  });

  it('removes skills no longer in the bundle on subsequent applies', async () => {
    const fakeReg = new FakeRegistry();
    const hiddenOps = new HiddenOpRegistry();
    const store = new BundleStore();
    const sync = new BundleSyncService(
      fakeReg as unknown as SkillRegistryInterface,
      hiddenOps,
      store,
      { requireSignature: false, trustedKeys: [] },
      fakeLogger,
    );

    await sync.apply(buildBundle());
    expect(hiddenOps.size).toBe(1);

    // Second apply: removes the skill entirely.
    const next = buildBundle({ skills: [], operations: {}, version: '2' });
    const result = await sync.apply(next);
    expect(result.applied).toBe(true);
    expect(fakeReg.unregistered).toContain('invoices');
    expect(hiddenOps.size).toBe(0);
  });

  it('rolls back hidden-op state if registration fails mid-apply', async () => {
    const fakeReg = new FakeRegistry();
    const hiddenOps = new HiddenOpRegistry();
    const store = new BundleStore();
    const sync = new BundleSyncService(
      fakeReg as unknown as SkillRegistryInterface,
      hiddenOps,
      store,
      { requireSignature: false, trustedKeys: [] },
      fakeLogger,
    );

    fakeReg.failNext = true;
    const result = await sync.apply(buildBundle());
    expect(result.applied).toBe(false);
    expect(hiddenOps.size).toBe(0); // restored to empty
    expect(store.current()).toBeUndefined();
  });

  it('changing a skill replaces the action set in hidden-op registry', async () => {
    const fakeReg = new FakeRegistry();
    const hiddenOps = new HiddenOpRegistry();
    const sync = new BundleSyncService(
      fakeReg as unknown as SkillRegistryInterface,
      hiddenOps,
      new BundleStore(),
      { requireSignature: false, trustedKeys: [] },
      fakeLogger,
    );

    await sync.apply(buildBundle());
    expect(hiddenOps.get('invoices', 'createInvoice')).toBeDefined();

    // Swap to a different op for the same skill
    const next = buildBundle({
      version: '2',
      skills: [
        {
          id: 'invoices',
          name: 'Invoices',
          description: 'Manage invoices.',
          instructions: '# v2',
          operationIds: ['voidInvoice'],
        },
      ],
      operations: {
        voidInvoice: {
          operationId: 'voidInvoice',
          serviceId: 'svc',
          httpMethod: 'POST',
          pathTemplate: '/v1/invoices/{id}/void',
          inputSchema: {},
          outputSchema: {},
          authBindingRef: 'def',
        },
      },
    });
    await sync.apply(next);
    expect(hiddenOps.get('invoices', 'createInvoice')).toBeUndefined();
    expect(hiddenOps.get('invoices', 'voidInvoice')?.op.pathTemplate).toBe('/v1/invoices/{id}/void');
  });
});
