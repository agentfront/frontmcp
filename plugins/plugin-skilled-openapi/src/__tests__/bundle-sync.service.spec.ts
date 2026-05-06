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
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
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
      { requireSignature: true, trustedKeys: [], exposeOperationsAsInternalTools: false },
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
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
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
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
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
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
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
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
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
          mapper: [],
          authBindingRef: 'def',
        },
      },
    });
    await sync.apply(next);
    expect(hiddenOps.get('invoices', 'createInvoice')).toBeUndefined();
    expect(hiddenOps.get('invoices', 'voidInvoice')?.op.pathTemplate).toBe('/v1/invoices/{id}/void');
  });

  describe('pinned bundle store', () => {
    it('short-circuits with applied:false when pinned to a different version', async () => {
      const fakeReg = new FakeRegistry();
      const store = new BundleStore();
      store.swap(buildBundle({ version: '7' }));
      store.pin('7');
      const sync = new BundleSyncService(
        fakeReg as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        store,
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
        fakeLogger,
      );
      const result = await sync.apply(buildBundle({ version: '8' }));
      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/pinned to 7.*8 not applied/);
      expect(fakeReg.registered).toHaveLength(0);
    });

    it('short-circuits with applied:false when pinned to the same version (would otherwise throw)', async () => {
      const fakeReg = new FakeRegistry();
      const store = new BundleStore();
      store.swap(buildBundle({ version: '7' }));
      store.pin('7');
      const sync = new BundleSyncService(
        fakeReg as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        store,
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
        fakeLogger,
      );
      const result = await sync.apply(buildBundle({ version: '7' }));
      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/already active/);
    });
  });

  describe('malformed bundle errors are surfaced via rollback', () => {
    it('throws a descriptive error when an operation references an unknown service', async () => {
      const fakeReg = new FakeRegistry();
      const sync = new BundleSyncService(
        fakeReg as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        new BundleStore(),
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
        fakeLogger,
      );
      const bundle = buildBundle();
      // Surgical mutation: clear services so rebuildHiddenOps can't resolve.
      const broken = { ...bundle, services: [] };
      const result = await sync.apply(broken as unknown as ResolvedBundle);
      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/unknown serviceId/);
    });

    it('throws when an operation references an unknown authBindingRef', async () => {
      const fakeReg = new FakeRegistry();
      const sync = new BundleSyncService(
        fakeReg as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        new BundleStore(),
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
        fakeLogger,
      );
      const bundle = buildBundle();
      const broken = { ...bundle, authBindings: {} };
      const result = await sync.apply(broken as unknown as ResolvedBundle);
      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/unknown authBindingRef/);
    });

    it('throws when a skill references an unknown operationId', async () => {
      const fakeReg = new FakeRegistry();
      const sync = new BundleSyncService(
        fakeReg as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        new BundleStore(),
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
        fakeLogger,
      );
      const bundle = buildBundle();
      const broken = { ...bundle, operations: {} };
      const result = await sync.apply(broken as unknown as ResolvedBundle);
      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/unknown operationId/);
    });
  });

  describe('internal tool factory wiring', () => {
    function makeFakeFactory() {
      return {
        register: jest.fn(),
        unregisterAll: jest.fn(),
      };
    }

    it('drives operationToolFactory.register for each hidden-op when exposeOperationsAsInternalTools=true', async () => {
      const fakeReg = new FakeRegistry();
      const factory = makeFakeFactory();
      const sync = new BundleSyncService(
        fakeReg as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        new BundleStore(),
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: true },
        fakeLogger,
        factory as never,
      );
      const result = await sync.apply(buildBundle());
      expect(result.applied).toBe(true);
      expect(factory.unregisterAll).toHaveBeenCalled();
      expect(factory.register).toHaveBeenCalledTimes(1);
    });

    it('logs a warning but applies anyway when an individual register call throws', async () => {
      const fakeReg = new FakeRegistry();
      const factory = {
        register: jest.fn(() => {
          throw new Error('register-boom');
        }),
        unregisterAll: jest.fn(),
      };
      const warn = jest.fn();
      const localLogger = { ...(fakeLogger as unknown as Record<string, unknown>), warn } as never;
      const sync = new BundleSyncService(
        fakeReg as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        new BundleStore(),
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: true },
        localLogger,
        factory as never,
      );
      const result = await sync.apply(buildBundle());
      expect(result.applied).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/internal-tool register failed/));
    });

    it('logs a warning when factory.unregisterAll throws (entire factory bails)', async () => {
      const fakeReg = new FakeRegistry();
      const factory = {
        register: jest.fn(),
        unregisterAll: jest.fn(() => {
          throw new Error('unregister-boom');
        }),
      };
      const warn = jest.fn();
      const localLogger = { ...(fakeLogger as unknown as Record<string, unknown>), warn } as never;
      const sync = new BundleSyncService(
        fakeReg as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        new BundleStore(),
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: true },
        localLogger,
        factory as never,
      );
      const result = await sync.apply(buildBundle());
      expect(result.applied).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/internal-tool factory error/));
    });

    it('on rollback, swallows factory restore errors silently', async () => {
      let firstApply = true;
      const registry: Pick<SkillRegistryInterface, 'registerSkillContent' | 'unregisterSkill'> = {
        async registerSkillContent(content) {
          if (!firstApply) {
            throw new Error('synthetic-failure');
          }
          return { id: content.id, unregister: async () => undefined };
        },
        async unregisterSkill() {
          return false;
        },
      };
      const factory = {
        register: jest
          .fn()
          .mockImplementationOnce(() => undefined) // first apply succeeds
          .mockImplementationOnce(() => {
            throw new Error('rollback-restore-boom');
          }),
        unregisterAll: jest
          .fn()
          .mockImplementationOnce(() => undefined) // first apply
          .mockImplementationOnce(() => {
            throw new Error('rollback-unregister-boom');
          }),
      };
      const sync = new BundleSyncService(
        registry as SkillRegistryInterface,
        new HiddenOpRegistry(),
        new BundleStore(),
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: true },
        fakeLogger,
        factory as never,
      );
      // First apply succeeds; second triggers rollback path that exercises
      // both swallow-paths inside the factory rollback block.
      const first = await sync.apply(buildBundle({ version: '1' }));
      expect(first.applied).toBe(true);
      firstApply = false;
      const second = await sync.apply(buildBundle({ version: '2' }));
      expect(second.applied).toBe(false);
      expect(second.reason).toMatch(/synthetic-failure/);
    });
  });

  it('logs an error when restoring a prior skill during rollback also fails', async () => {
    // The rollback "restore prior skill" path only runs when the staged apply
    // registered at least one skill before failing on a later one — that's
    // when `newHandles` is non-empty AND has a corresponding entry in
    // `priorContents`. Use a two-skill bundle so the first register succeeds
    // and the second throws.
    let v2RegisterCount = 0;
    let phase: 'v1' | 'v2' = 'v1';
    const registry: Pick<SkillRegistryInterface, 'registerSkillContent' | 'unregisterSkill'> = {
      async registerSkillContent(content) {
        if (phase === 'v1') {
          // The rollback re-register call uses the source `:rollback` suffix;
          // when phase is v1 we accept everything to set up state.
          return { id: content.id, unregister: async () => undefined };
        }
        // phase v2:
        v2RegisterCount += 1;
        if (v2RegisterCount === 1) {
          // first new register succeeds → newHandles populated with `invoices`.
          return { id: content.id, unregister: async () => undefined };
        }
        if (v2RegisterCount === 2) {
          // second new register throws → triggers rollback path.
          throw new Error('upgrade-fail');
        }
        // rollback restore call → fails.
        throw new Error('rollback-restore-fail');
      },
      async unregisterSkill() {
        return false;
      },
    };
    const error = jest.fn();
    const localLogger = { ...(fakeLogger as unknown as Record<string, unknown>), error } as never;
    const sync = new BundleSyncService(
      registry as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      localLogger,
    );

    const v1 = buildBundle({
      version: '1',
      skills: [
        { id: 'invoices', name: 'I', description: 'd', instructions: '#', operationIds: ['createInvoice'] },
        { id: 'reports', name: 'R', description: 'd', instructions: '#', operationIds: ['createInvoice'] },
      ],
    });
    expect((await sync.apply(v1)).applied).toBe(true);

    phase = 'v2';
    const v2 = buildBundle({
      version: '2',
      skills: [
        { id: 'invoices', name: 'I2', description: 'd', instructions: '#', operationIds: ['createInvoice'] },
        { id: 'reports', name: 'R2', description: 'd', instructions: '#', operationIds: ['createInvoice'] },
      ],
    });
    const second = await sync.apply(v2);
    expect(second.applied).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/failed to restore prior skill/));
  });
});
