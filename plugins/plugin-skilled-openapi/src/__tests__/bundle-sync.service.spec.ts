import { BundleStore, type ResolvedBundle } from '@frontmcp/adapters/skills';
import { type SkillContent, type SkillRegistryInterface } from '@frontmcp/sdk';

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

  it('rollback restores the previous bundle when a registration fails on an upgrade', async () => {
    // Atomicity contract: removed/replaced skills must remain visible after a
    // failed bundle apply. Previously the service unregistered removed skills
    // and dropped replaced handles BEFORE all new registrations completed, so
    // a registration failure mid-apply left the registry with neither the new
    // bundle's skills nor the prior bundle's. This test pins that down.
    const hiddenOps = new HiddenOpRegistry();
    const store = new BundleStore();
    let nextRegistrationFails = false;

    const registry: Pick<SkillRegistryInterface, 'registerSkillContent' | 'unregisterSkill'> = {
      async registerSkillContent(content) {
        if (nextRegistrationFails) {
          nextRegistrationFails = false;
          throw new Error('synthetic registration failure on upgrade');
        }
        return {
          id: content.id,
          unregister: async () => {
            // no-op for this test — the assertion is on the registry state
            // we observe via apply(), not on the test fake.
          },
        };
      },
      async unregisterSkill() {
        return false;
      },
    };

    const sync = new BundleSyncService(
      registry as SkillRegistryInterface,
      hiddenOps,
      store,
      { requireSignature: false, trustedKeys: [] },
      fakeLogger,
    );

    // First apply: succeeds, becomes the active bundle.
    const v1 = buildBundle({
      skills: [
        {
          id: 'invoices',
          name: 'Invoices',
          description: 'd',
          instructions: '# v1',
          operationIds: ['createInvoice'],
        },
        {
          id: 'reports',
          name: 'Reports',
          description: 'd',
          instructions: '# v1',
          operationIds: ['createInvoice'],
        },
      ],
    });
    const firstResult = await sync.apply(v1);
    expect(firstResult.applied).toBe(true);
    expect(store.current()).toBe(v1);

    // Second apply: removes `reports`, changes `invoices`, but registration
    // throws on the very first call so we never reach the unregister step.
    nextRegistrationFails = true;
    const v2 = buildBundle({
      version: '2',
      skills: [
        {
          id: 'invoices',
          name: 'Invoices v2',
          description: 'd',
          instructions: '# v2',
          operationIds: ['createInvoice'],
        },
      ],
    });
    const secondResult = await sync.apply(v2);
    expect(secondResult.applied).toBe(false);
    expect(secondResult.reason).toMatch(/synthetic registration failure/);

    // BundleStore was not swapped — listeners observe the prior bundle.
    expect(store.current()).toBe(v1);
    // HiddenOpRegistry was restored from the snapshot — both skills' entries
    // come back at the prior bundle's version.
    expect(hiddenOps.size).toBe(2);
    expect(hiddenOps.get('invoices', 'createInvoice')?.bundleVersion).toBe('1');
    expect(hiddenOps.get('reports', 'createInvoice')?.bundleVersion).toBe('1');
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
