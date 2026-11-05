import {
  BundleStore,
  OverlayParseError,
  SaasJwksUnavailableError,
  SaasPullTokenRejectedError,
  type BundleOrigin,
  type BundleSourceListener,
  type BundleTokenFailure,
  type ResolvedBundle,
} from '@frontmcp/adapters/skills';
import {
  PublicMcpError,
  SkillBundleNotLoadedError,
  type RegisteredSkillContent,
  type RegisterSkillContentOptions,
  type SkillContent,
  type SkillRegistryInterface,
} from '@frontmcp/sdk';

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

// Typed handle to the jest mocks for assertions (`fakeLogger` is cast to `never`
// so it can stand in for `FrontMcpLogger` at the constructor call sites).
const loggerMocks = fakeLogger as unknown as { error: jest.Mock; warn: jest.Mock };

class FakeRegistry implements Partial<SkillRegistryInterface> {
  public registered: SkillContent[] = [];
  public registeredOptions: (RegisterSkillContentOptions | undefined)[] = [];
  public unregistered: string[] = [];
  public failNext = false;
  /** Registrations to fail, by skill id. */
  public failOn = new Set<string>();
  /** Superseded ids a registration reports as removed, by the registered skill's id. */
  public removedBy = new Map<string, string[]>();

  async registerSkillContent(
    content: SkillContent,
    opts?: RegisterSkillContentOptions,
  ): Promise<RegisteredSkillContent> {
    if (this.failNext || this.failOn.has(content.id)) {
      this.failNext = false;
      throw new Error('synthetic registration failure');
    }
    this.registered.push(content);
    this.registeredOptions.push(opts);
    return {
      id: content.id,
      unregister: async () => {
        this.unregistered.push(content.id);
      },
      removed: this.removedBy.get(content.id) ?? [],
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

  describe('ensureReady (worker-safe lazy boot)', () => {
    // Guards the stateless-worker fix: the catalog must load when a meta-tool
    // awaits ensureReady() — driving the source start + first apply inline,
    // memoized — rather than relying on a background-loop-deferred boot.
    const makeSource = (bundle: ResolvedBundle) => {
      const listeners = new Set<(b: ResolvedBundle) => void>();
      const calls = { start: 0 };
      return {
        calls,
        source: {
          async start() {
            calls.start++;
            for (const fn of listeners) fn(bundle);
          },
          onChange(fn: (b: ResolvedBundle) => void) {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
        },
      };
    };

    const makeSync = (reg: FakeRegistry) =>
      new BundleSyncService(
        reg as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        new BundleStore(),
        { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
        fakeLogger,
      );

    it('starts the source once and applies the first bundle; memoized across calls', async () => {
      const reg = new FakeRegistry();
      const sync = makeSync(reg);
      const { calls, source } = makeSource(buildBundle());
      sync.attachSource(source);

      // Not booted until ensureReady() is called.
      expect(calls.start).toBe(0);
      expect(reg.registered).toHaveLength(0);

      await sync.ensureReady();
      expect(calls.start).toBe(1);
      expect(reg.registered).toHaveLength(1);
      expect(reg.registered[0].id).toBe('invoices');

      // Memoized: a second call neither restarts the source nor re-applies.
      await sync.ensureReady();
      expect(calls.start).toBe(1);
      expect(reg.registered).toHaveLength(1);
    });

    it('is a no-op when no source is attached', async () => {
      const sync = makeSync(new FakeRegistry());
      await expect(sync.ensureReady()).resolves.toBeUndefined();
    });

    it('does not throw (swallows + logs) when the source fails to start', async () => {
      const sync = makeSync(new FakeRegistry());
      sync.attachSource({
        async start() {
          throw new Error('boom');
        },
        onChange() {
          return () => {};
        },
      });
      await expect(sync.ensureReady()).resolves.toBeUndefined();
      expect(loggerMocks.error).toHaveBeenCalledWith(expect.stringMatching(/initial bundle sync failed.*boom/));
    });

    it('does not hang when start() returns without emitting (SaaS pull already in-flight)', async () => {
      const reg = new FakeRegistry();
      const sync = makeSync(reg);
      // Mimics SaasPullSource short-circuiting when a Cron refresh holds inFlight:
      // start() returns without notifying. ensureReady() must resolve, not hang.
      sync.attachSource({
        async start() {
          /* no emit */
        },
        onChange() {
          return () => {};
        },
      });
      await expect(sync.ensureReady()).resolves.toBeUndefined();
      expect(reg.registered).toHaveLength(0);
    });
  });

  describe('load state and ensureLoaded', () => {
    /** A source the test drives: `start()` runs `onStart`, and `emit()` hands a bundle to the listeners later. */
    const makeDrivenSource = (onStart: (emit: (bundle: ResolvedBundle) => void) => Promise<void>) => {
      const listeners = new Set<(b: ResolvedBundle) => void>();
      const emit = (bundle: ResolvedBundle) => {
        for (const fn of listeners) fn(bundle);
      };
      return {
        emit,
        source: {
          start: () => onStart(emit),
          onChange(fn: (b: ResolvedBundle) => void) {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
        },
      };
    };

    const makeSync = (requireSignature = false) =>
      new BundleSyncService(
        new FakeRegistry() as unknown as SkillRegistryInterface,
        new HiddenOpRegistry(),
        new BundleStore(),
        { requireSignature, trustedKeys: [], exposeOperationsAsInternalTools: false },
        fakeLogger,
      );

    const untilLoaded = async (sync: BundleSyncService) => {
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline && sync.loadState().status !== 'loaded') {
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    it('is loading before the first load, then loaded with the bundle id and version', async () => {
      const sync = makeSync();
      const { source } = makeDrivenSource(async (emit) => emit(buildBundle({ version: '2.0.0' })));
      sync.attachSource(source);

      const before = sync.loadState();
      await sync.ensureLoaded();

      expect(before).toEqual({ status: 'loading' });
      expect(sync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '2.0.0' });
    });

    it('refuses with the reason, and the issues the schema check found, when the source fails to start', async () => {
      const sync = makeSync();
      const { source } = makeDrivenSource(async () => {
        throw new OverlayParseError('Bundle schema validation failed (1 issue(s))', [
          'generatedAt: Invalid input: expected string, received Date',
        ]);
      });
      sync.attachSource(source);
      const reason =
        'Bundle schema validation failed (1 issue(s)): generatedAt: Invalid input: expected string, received Date';

      const refusal = sync.ensureLoaded();

      await expect(refusal).rejects.toBeInstanceOf(PublicMcpError);
      await expect(refusal).rejects.toMatchObject({
        message: `No skill bundle is loaded: ${reason}`,
        code: 'SKILL_BUNDLE_NOT_LOADED',
      });
      expect(sync.loadState()).toEqual({ status: 'failed', reason });
      expect(loggerMocks.error).toHaveBeenCalledWith(`[skilled-openapi] initial bundle sync failed: ${reason}`);
    });

    it('refuses while the source has started without a first bundle', async () => {
      const sync = makeSync();
      const { source } = makeDrivenSource(async () => undefined);
      sync.attachSource(source);

      await expect(sync.ensureLoaded()).rejects.toMatchObject({
        message: 'No skill bundle is loaded: the first bundle has not loaded yet',
        code: 'SKILL_BUNDLE_NOT_LOADED',
      });
    });

    it("refuses with the SDK's retryable error, the one its skill surfaces answer", async () => {
      const sync = makeSync();
      sync.recordLoadFailure('pull responded 503');

      const refusal = sync.ensureLoaded();

      await expect(refusal).rejects.toBeInstanceOf(SkillBundleNotLoadedError);
      await expect(
        refusal.catch((error: SkillBundleNotLoadedError) => error.toMcpError()._meta),
      ).resolves.toMatchObject({ code: 'SKILL_BUNDLE_NOT_LOADED', retryable: true });
    });

    it('gives the reason no bundle is loaded, the one ensureLoaded refuses with, and none once one is', async () => {
      const sync = makeSync();
      const { source } = makeDrivenSource(async (emit) => emit(buildBundle({ version: '2.0.0' })));
      sync.attachSource(source);
      const beforeStart = sync.notLoadedReason();
      sync.recordLoadFailure('pull responded 503');
      const afterFailure = sync.notLoadedReason();

      await sync.ensureLoaded();

      expect(beforeStart).toBe('the first bundle has not loaded yet');
      expect(afterFailure).toBe('pull responded 503');
      expect(sync.notLoadedReason()).toBeUndefined();
    });

    it('refuses with the recorded reason when the bundle source could not be created', async () => {
      const sync = makeSync();
      sync.recordLoadFailure("the bundle source could not be created: ENOENT: no such file, open '/srv/b.json'");

      await expect(sync.ensureLoaded()).rejects.toThrow(
        "No skill bundle is loaded: the bundle source could not be created: ENOENT: no such file, open '[path]'",
      );
    });

    it('refuses, naming the bundle and why, when the first bundle is not applied', async () => {
      const sync = makeSync(true);
      const { source } = makeDrivenSource(async (emit) => emit(buildBundle()));
      sync.attachSource(source);

      await expect(sync.ensureLoaded()).rejects.toThrow(
        'No skill bundle is loaded: bundle acme:prod@1 was not applied: bundle missing integrity envelope',
      );
    });

    it('serves again once a later bundle is applied', async () => {
      const sync = makeSync();
      const { source, emit } = makeDrivenSource(async () => {
        throw new Error('pull responded 503');
      });
      sync.attachSource(source);
      await expect(sync.ensureLoaded()).rejects.toThrow('No skill bundle is loaded: pull responded 503');

      emit(buildBundle({ version: '1.0.1' }));
      await untilLoaded(sync);

      await expect(sync.ensureLoaded()).resolves.toBeUndefined();
      expect(sync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '1.0.1' });
    });

    it('keeps serving the loaded bundle when a later one is not applied', async () => {
      const sync = makeSync();
      const { source, emit } = makeDrivenSource(async (next) => next(buildBundle({ version: '1.0.0' })));
      sync.attachSource(source);
      await sync.ensureLoaded();
      const unknownOperation = buildBundle({ version: '1.1.0' });
      unknownOperation.skills[0].operationIds = ['missingOperation'];

      emit(unknownOperation);
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline && !String(loggerMocks.warn.mock.calls.at(-1)?.[0]).includes('1.1.0 not applied')) {
        await new Promise((r) => setTimeout(r, 5));
      }

      expect(loggerMocks.warn).toHaveBeenLastCalledWith(expect.stringContaining('acme:prod@1.1.0 not applied'));
      await expect(sync.ensureLoaded()).resolves.toBeUndefined();
      expect(sync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '1.0.0' });
    });

    it('gives clients a reason without the credentials and query of a URL in the error', async () => {
      const sync = makeSync();
      const { source } = makeDrivenSource(async () => {
        throw new Error('fetch https://puller:s3cret@cloud.example.dev/v1/bundles?token=abc123 failed');
      });
      sync.attachSource(source);

      await expect(sync.ensureLoaded()).rejects.toThrow(
        'No skill bundle is loaded: fetch https://cloud.example.dev/v1/bundles failed',
      );
    });
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

  it("names the previous bundle's skills it has not registered again as superseded", async () => {
    // The registry refuses a skill whose id is another skill's path. Every new skill is registered
    // before the dropped ones are removed, so without `supersedes` a bundle that gives a new skill
    // the path a dropped (or renamed) skill holds now would be refused and rolled back.
    const fakeReg = new FakeRegistry();
    const sync = new BundleSyncService(
      fakeReg as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );
    const skill = (id: string, name: string) => ({
      id,
      name,
      description: `${name} skill`,
      instructions: `# ${name}`,
      operationIds: [],
    });

    // `invoices` holds the path `target`; the next bundle drops it and adds a skill with id `target`.
    await sync.apply(
      buildBundle({ skills: [skill('invoices', 'target'), skill('reports', 'reports')], operations: {} }),
    );
    expect(fakeReg.registeredOptions.map((opts) => opts?.supersedes)).toEqual([[], []]);

    fakeReg.registered = [];
    fakeReg.registeredOptions = [];
    const result = await sync.apply(
      buildBundle({ skills: [skill('target', 'other'), skill('reports', 'quarterly')], operations: {}, version: '2' }),
    );

    expect(result.applied).toBe(true);
    const supersededById = new Map(
      fakeReg.registered.map((content, i) => [content.id, fakeReg.registeredOptions[i]?.supersedes] as const),
    );
    // Each registration names the prior skills not registered again before it, whatever the load order.
    const [first, second] = fakeReg.registered.map((content) => content.id);
    expect([...(supersededById.get(first) ?? [])].sort()).toEqual(['invoices', 'reports']);
    expect([...(supersededById.get(second) ?? [])].sort()).toEqual(
      ['invoices', 'reports'].filter((id) => id !== first),
    );
    expect(supersededById.get('target')).toContain('invoices');
    expect(fakeReg.unregistered).toEqual(['invoices']);
  });

  it('treats the superseded skills a registration removed as removed, and restores them on rollback', async () => {
    const fakeReg = new FakeRegistry();
    const sync = new BundleSyncService(
      fakeReg as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );
    const skill = (id: string, name: string) => ({
      id,
      name,
      description: `${name} skill`,
      instructions: `# ${name}`,
      operationIds: [],
    });
    await sync.apply(buildBundle({ skills: [skill('invoices', 'target')], operations: {} }));

    // The registry removes `invoices` when `target` takes its path.
    fakeReg.removedBy.set('target', ['invoices']);
    const applied = await sync.apply(buildBundle({ skills: [skill('target', 'other')], operations: {}, version: '2' }));
    expect(applied.applied).toBe(true);
    // Already removed by the registry: its own handle is not called again.
    expect(fakeReg.unregistered).toEqual([]);

    // A failed apply restores a skill the registry removed that way.
    const again = new FakeRegistry();
    const failing = new BundleSyncService(
      again as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );
    await failing.apply(buildBundle({ skills: [skill('invoices', 'target')], operations: {} }));
    again.registered = [];
    again.removedBy.set('target', ['invoices']);
    again.failOn.add('zeta');
    const rolledBack = await failing.apply(
      buildBundle({ skills: [skill('target', 'other'), skill('zeta', 'zeta')], operations: {}, version: '2' }),
    );

    expect(rolledBack.applied).toBe(false);
    expect(again.unregistered).toEqual(['target']);
    expect(again.registered.map((content) => content.id)).toEqual(['target', 'invoices']);
    expect(again.registered[1].name).toBe('target');
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

describe('BundleSyncService last good bundle', () => {
  const makeSync = (registry = new FakeRegistry()) =>
    new BundleSyncService(
      registry as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );

  /** A source that pulls `first` when it starts, hands later pulls to `pull()`, and records the bundles it keeps. */
  const cachingSource = (first: ResolvedBundle) => {
    const listeners = new Set<(b: ResolvedBundle) => Promise<void>>();
    const kept: string[] = [];
    const notify = async (bundle: ResolvedBundle) => {
      for (const fn of listeners) await fn(bundle);
    };
    return {
      kept,
      pull: notify,
      source: {
        start: () => notify(first),
        onChange(fn: (b: ResolvedBundle) => Promise<void>) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        async keepBundle(bundle: ResolvedBundle) {
          kept.push(bundle.version);
        },
      },
    };
  };

  const refunds = { id: 'refunds', name: 'Refunds', description: 'd', instructions: '# R', operationIds: [] };

  it('keeps each pulled bundle it applies, before the pull counts as done, and never one it refuses', async () => {
    const registry = new FakeRegistry();
    registry.failOn.add('refunds');
    const sync = makeSync(registry);
    const { source, pull, kept } = cachingSource(buildBundle({ version: '1' }));
    sync.attachSource(source);
    await sync.ensureLoaded();

    await pull(buildBundle({ version: '2', skills: [refunds] }));
    const keptAfterRefusal = [...kept];
    await pull(buildBundle({ version: '3' }));

    expect(keptAfterRefusal).toEqual(['1']);
    expect(kept).toEqual(['1', '3']);
    expect(sync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '3' });
  });

  it('does not keep a pulled bundle whose signature check fails', async () => {
    const sync = new BundleSyncService(
      new FakeRegistry() as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: true, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );
    const { source, kept } = cachingSource(buildBundle({ version: '1' }));
    sync.attachSource(source);

    await sync.ensureReady();

    expect(kept).toEqual([]);
    expect(sync.loadState()).toMatchObject({ status: 'failed' });
  });

  it('does not keep a pulled bundle while the bundle store is pinned', async () => {
    const store = new BundleStore();
    const sync = new BundleSyncService(
      new FakeRegistry() as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      store,
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );
    const { source, pull, kept } = cachingSource(buildBundle({ version: '1' }));
    sync.attachSource(source);
    await sync.ensureLoaded();
    store.pin('1');

    await pull(buildBundle({ version: '2' }));

    expect(kept).toEqual(['1']);
  });
});

describe('BundleSyncService refresh, as a scheduler runs it', () => {
  const makeSync = () =>
    new BundleSyncService(
      new FakeRegistry() as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );

  type Pull = string | ({ cached: string } & Required<Pick<BundleOrigin, 'pullFailure'>> & BundleOrigin) | Error;

  /**
   * A forward-only source whose start and refresh each take the next of `pulls`: a version it pulls, the cached
   * version it serves because the pull failed, or the error the pull fails with. It records what it kept, and hands
   * `failPoll()` to its pull failure listeners, as a poll that fails does.
   */
  const pullingSource = (pulls: Pull[]) => {
    const listeners = new Set<BundleSourceListener>();
    const pullFailureListeners = new Set<(reason: string, tokenFailure?: BundleTokenFailure) => void>();
    const calls = { start: 0, refresh: 0 };
    const kept: string[] = [];
    const pullNext = async () => {
      const pull = pulls.shift() ?? new Error('pull responded 503');
      if (pull instanceof Error) throw pull;
      const [version, origin] = typeof pull === 'string' ? [pull] : [pull.cached, pull];
      for (const fn of listeners) await fn(buildBundle({ version }), origin);
    };
    return {
      calls,
      kept,
      failPoll: (reason: string, tokenFailure?: BundleTokenFailure) =>
        pullFailureListeners.forEach((fn) => fn(reason, tokenFailure)),
      source: {
        forwardOnly: true,
        push: { verifyPushToken: jest.fn() },
        async start() {
          calls.start++;
          await pullNext();
        },
        async refresh() {
          calls.refresh++;
          await pullNext();
        },
        onChange(fn: BundleSourceListener) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        onPullFailure(fn: (reason: string, tokenFailure?: BundleTokenFailure) => void) {
          pullFailureListeners.add(fn);
          return () => pullFailureListeners.delete(fn);
        },
        async keepBundle(bundle: ResolvedBundle) {
          kept.push(bundle.version);
        },
      },
    };
  };

  const at = expect.any(String);

  it('starts the source when nothing started it, and applies and keeps that pull without pulling again', async () => {
    const sync = makeSync();
    const { source, calls, kept } = pullingSource(['1']);
    sync.attachSource(source);

    const outcome = await sync.refresh();

    expect(outcome).toEqual({ status: 'applied', bundleId: 'acme:prod', bundleVersion: '1', at });
    expect(calls).toEqual({ start: 1, refresh: 0 });
    expect(kept).toEqual(['1']);
    expect(sync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '1' });
  });

  it('pulls again through the source once it has started, and waits for that bundle to be applied and kept', async () => {
    const sync = makeSync();
    const { source, calls, kept } = pullingSource(['1', '2']);
    sync.attachSource(source);
    await sync.ensureReady();

    const outcome = await sync.refresh();

    expect(outcome).toEqual({ status: 'applied', bundleId: 'acme:prod', bundleVersion: '2', at });
    expect(calls).toEqual({ start: 1, refresh: 1 });
    expect(kept).toEqual(['1', '2']);
    expect(sync.loadState()).toMatchObject({ status: 'loaded', bundleVersion: '2' });
  });

  it('says a pull of the bundle being served is unchanged, and one older than it refused, with why', async () => {
    const sync = makeSync();
    const { source, kept } = pullingSource(['2.0.0', '2.0.0', '1.0.0']);
    sync.attachSource(source);
    await sync.ensureReady();

    const unchanged = await sync.refresh();
    const refused = await sync.refresh();

    expect(unchanged).toEqual({ status: 'unchanged', bundleId: 'acme:prod', bundleVersion: '2.0.0', at });
    expect(refused).toEqual({
      status: 'refused',
      bundleId: 'acme:prod',
      bundleVersion: '1.0.0',
      reason: 'older than the served bundle acme:prod@2.0.0 (generatedAt 2026-05-04T00:00:00Z)',
      at,
    });
    expect(kept).toEqual(['2.0.0', '2.0.0']);
    expect(sync.loadState()).toMatchObject({ status: 'loaded', bundleVersion: '2.0.0' });
  });

  it('resolves as failed when the start it runs loads no bundle, or when a later pull fails: the served one stays', async () => {
    const coldSync = makeSync();
    coldSync.attachSource(pullingSource([]).source);
    const warmSync = makeSync();
    warmSync.attachSource(pullingSource(['1']).source);
    await warmSync.ensureReady();

    const cold = await coldSync.refresh();
    const warm = await warmSync.refresh();

    expect(cold).toEqual({ status: 'failed', reason: 'pull responded 503', cacheFallback: false, at });
    expect(warm).toEqual({ ...cold, at });
    expect(coldSync.loadState()).toEqual({ status: 'failed', reason: 'pull responded 503' });
    expect(warmSync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '1' });
  });

  it('resolves as failed, serving the cached bundle, when the start it runs could not pull', async () => {
    const sync = makeSync();
    sync.attachSource(pullingSource([{ cached: '1', pullFailure: 'fetch failed' }]).source);

    const outcome = await sync.start();

    expect(outcome).toEqual({ status: 'failed', reason: 'fetch failed', cacheFallback: true, at });
    expect(sync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '1' });
  });

  it('says the cached bundle does not serve when it is refused too', async () => {
    const sync = new BundleSyncService(
      new FakeRegistry() as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: true, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );
    sync.attachSource(pullingSource([{ cached: '1', pullFailure: 'fetch failed' }]).source);

    const outcome = await sync.start();

    expect(outcome).toEqual({ status: 'failed', reason: 'fetch failed', cacheFallback: false, at });
    expect(sync.loadState()).toMatchObject({ status: 'failed' });
  });

  it('records a poll that fails, and the push applied after it', async () => {
    const sync = makeSync();
    const { source, failPoll } = pullingSource(['1.0.0']);
    sync.attachSource(source);
    await sync.ensureReady();

    failPoll('pull responded 502');
    const afterPoll = sync.lastSyncOutcome();
    await sync.applyPushed(buildBundle({ version: '1.1.0' }));

    expect(afterPoll).toEqual({ status: 'failed', reason: 'pull responded 502', cacheFallback: false, at });
    expect(sync.lastSyncOutcome()).toEqual({ status: 'applied', bundleId: 'acme:prod', bundleVersion: '1.1.0', at });
  });

  describe('names the token check a pull failed on', () => {
    const rejected = (tokenFailure: BundleTokenFailure) =>
      new SaasPullTokenRejectedError('not a valid token from the issuer', tokenFailure);

    it('on the start a refresh runs, which loads no bundle', async () => {
      const sync = makeSync();
      sync.attachSource(pullingSource([rejected('expired')]).source);

      const outcome = await sync.refresh();

      const reason = '[saas-source] pull token rejected: not a valid token from the issuer';
      expect(outcome).toEqual({ status: 'failed', reason, tokenFailure: 'expired', cacheFallback: false, at });
      expect(sync.loadState()).toEqual({ status: 'failed', reason });
    });

    it('on a refresh, while the bundle before it serves', async () => {
      const sync = makeSync();
      sync.attachSource(pullingSource(['1', rejected('unknown_key')]).source);
      await sync.ensureReady();

      expect(await sync.refresh()).toMatchObject({ status: 'failed', tokenFailure: 'unknown_key' });
      expect(sync.loadState()).toMatchObject({ status: 'loaded', bundleVersion: '1' });
    });

    it('on a poll', async () => {
      const sync = makeSync();
      const { source, failPoll } = pullingSource(['1']);
      sync.attachSource(source);
      await sync.ensureReady();

      failPoll('[saas-source] pull token rejected: its "aud" claim does not include "acme:prod"', 'wrong_audience');

      expect(sync.lastSyncOutcome()).toMatchObject({ status: 'failed', tokenFailure: 'wrong_audience' });
    });

    it('on a start that serves the cached bundle because the JWKS was unavailable', async () => {
      const sync = makeSync();
      const pullFailure = 'JWKS https://cloud.example.dev/.well-known/jwks.json responded 503';
      sync.attachSource(pullingSource([{ cached: '1', pullFailure, tokenFailure: 'jwks_unavailable' }]).source);

      expect(await sync.start()).toEqual({
        status: 'failed',
        reason: pullFailure,
        tokenFailure: 'jwks_unavailable',
        cacheFallback: true,
        at,
      });
    });

    it('on a refresh whose JWKS could not be read', async () => {
      const sync = makeSync();
      sync.attachSource(pullingSource(['1', new SaasJwksUnavailableError('fetch failed')]).source);
      await sync.ensureReady();

      expect(await sync.refresh()).toMatchObject({
        status: 'failed',
        reason: 'fetch failed',
        tokenFailure: 'jwks_unavailable',
      });
    });

    it('and names none for a pull that failed for another reason', async () => {
      const sync = makeSync();
      sync.attachSource(pullingSource(['1', new Error('pull responded 502')]).source);
      await sync.ensureReady();

      const outcome = await sync.refresh();

      expect(outcome).toMatchObject({ status: 'failed', reason: 'pull responded 502' });
      expect(outcome).not.toHaveProperty('tokenFailure', expect.anything());
    });
  });

  it('records a pushed bundle that is refused', async () => {
    const sync = makeSync();
    sync.attachSource(pullingSource(['2.0.0']).source);

    await sync.applyPushed(buildBundle({ version: '1.0.0' }));

    expect(sync.lastSyncOutcome()).toMatchObject({ status: 'refused', bundleVersion: '1.0.0' });
  });

  it('gives each reason as clients may read it: no URL credentials or query, no token', async () => {
    const sync = makeSync();
    const token = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln';
    sync.attachSource(
      pullingSource(['1', new Error(`pull https://ci:secret@cloud.example.dev/v1/b?sig=abc rejected ${token}`)]).source,
    );
    await sync.ensureReady();

    const outcome = await sync.refresh();

    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'pull https://cloud.example.dev/v1/b rejected [token]',
    });
  });

  it('says the first bundle has not loaded when the source started without one', async () => {
    const sync = makeSync();
    sync.attachSource({ start: async () => undefined, onChange: () => () => undefined });

    expect(sync.lastSyncOutcome()).toBeUndefined();
    await expect(sync.start()).resolves.toEqual({
      status: 'failed',
      reason: 'the first bundle has not loaded yet',
      cacheFallback: false,
      at,
    });
  });
});

describe('BundleSyncService pushed bundles', () => {
  const pushReceiver = { verifyPushToken: jest.fn() };

  const makeSync = (registry = new FakeRegistry()) =>
    new BundleSyncService(
      registry as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );

  /** A source that emits `pulled` when it starts, takes pushed bundles, and keeps applied ones with `keepBundle`. */
  const pullingSource = (pulled: ResolvedBundle, keepBundle?: (bundle: ResolvedBundle) => Promise<void>) => {
    const listeners = new Set<(b: ResolvedBundle) => void>();
    return {
      push: pushReceiver,
      keepBundle,
      async start() {
        for (const fn of listeners) fn(pulled);
      },
      onChange(fn: (b: ResolvedBundle) => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  };

  it("exposes the source's push checks, and none without a source that takes pushes", () => {
    const pushing = makeSync();
    pushing.attachSource(pullingSource(buildBundle()));
    const pullOnly = makeSync();
    pullOnly.attachSource({ start: async () => undefined, onChange: () => () => undefined });

    expect(pushing.pushReceiver).toBe(pushReceiver);
    expect(pullOnly.pushReceiver).toBeUndefined();
    expect(makeSync().pushReceiver).toBeUndefined();
  });

  it('applies a pushed bundle after the bundle the source pulls when it starts', async () => {
    const registry = new FakeRegistry();
    const sync = makeSync(registry);
    sync.attachSource(pullingSource(buildBundle({ version: '1' })));

    const result = await sync.applyPushed(buildBundle({ version: '2' }));

    expect(result).toMatchObject({ applied: true, bundleId: 'acme:prod', bundleVersion: '2' });
    expect(registry.registered.map((skill) => skill.bundleVersion)).toEqual(['1', '2']);
    expect(sync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '2' });
  });

  it('keeps a pushed bundle once it is applied, before the next queued apply starts', async () => {
    const sync = makeSync();
    const events: string[] = [];
    const keepApplied = async (bundle: ResolvedBundle) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push(`kept ${bundle.version}`);
    };
    sync.attachSource(pullingSource(buildBundle({ version: '1' }), keepApplied));
    const applySpy = jest.spyOn(sync, 'apply');
    applySpy.mockImplementation(async (bundle) => {
      events.push(`apply ${bundle.version}`);
      return { applied: true, bundleId: bundle.bundleId, bundleVersion: bundle.version };
    });

    await Promise.all([
      sync.applyPushed(buildBundle({ version: '2' })),
      sync.applyPushed(buildBundle({ version: '3' })),
    ]);

    expect(events.filter((event) => !event.endsWith(' 1'))).toEqual(['apply 2', 'kept 2', 'apply 3', 'kept 3']);
  });

  it('does not keep a pushed bundle that is not applied, and a failure to keep one leaves it applied', async () => {
    const registry = new FakeRegistry();
    registry.failOn.add('refunds');
    const sync = makeSync(registry);
    const keepApplied = jest.fn(async () => {
      throw new Error('KV unavailable');
    });
    sync.attachSource(pullingSource(buildBundle({ version: '1' }), keepApplied));
    const refunds = { id: 'refunds', name: 'Refunds', description: 'd', instructions: '# R', operationIds: [] };

    const refused = await sync.applyPushed(buildBundle({ version: '2', skills: [refunds] }));
    const applied = await sync.applyPushed(buildBundle({ version: '3' }));

    expect(refused).toMatchObject({ applied: false });
    expect(applied).toMatchObject({ applied: true, bundleVersion: '3' });
    expect(keepApplied).toHaveBeenCalledTimes(2);
    expect(keepApplied).toHaveBeenLastCalledWith(expect.objectContaining({ version: '3' }));
    expect(loggerMocks.warn).toHaveBeenCalledWith(expect.stringContaining('keeping it as the last good bundle failed'));
  });

  it('reports a pushed bundle that is not applied, and keeps serving the bundle before it', async () => {
    const registry = new FakeRegistry();
    registry.failOn.add('refunds');
    const sync = makeSync(registry);
    sync.attachSource(pullingSource(buildBundle({ version: '1' })));
    const refunds = { id: 'refunds', name: 'Refunds', description: 'd', instructions: '# R', operationIds: [] };

    const result = await sync.applyPushed(buildBundle({ version: '2', skills: [refunds] }));

    expect(result).toMatchObject({ applied: false, bundleVersion: '2' });
    expect(sync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '1' });
  });

  it('reports a pushed bundle whose apply throws as not applied', async () => {
    const sync = makeSync();
    jest.spyOn(sync, 'apply').mockRejectedValueOnce(new Error('registry offline'));

    const result = await sync.applyPushed(buildBundle({ version: '3' }));

    expect(result).toMatchObject({
      applied: false,
      bundleVersion: '3',
      reason: expect.stringContaining('registry offline'),
    });
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.stringContaining('acme:prod@3 apply threw: registry offline'),
    );
  });
});

describe('BundleSyncService version order', () => {
  const EARLIER = '2026-11-04T10:00:00.000Z';
  const LATER = '2026-11-04T12:00:00.000Z';

  const makeSync = (registry = new FakeRegistry()) =>
    new BundleSyncService(
      registry as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      new BundleStore(),
      { requireSignature: false, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );

  /** A source that pulls `first` when it starts, hands later pulls to `pull()`, takes pushes, and records what it keeps. */
  const orderedSource = (first: ResolvedBundle, forwardOnly: boolean | undefined) => {
    const listeners = new Set<(b: ResolvedBundle) => Promise<void>>();
    const kept: ResolvedBundle[] = [];
    return {
      kept,
      pull: async (bundle: ResolvedBundle) => {
        for (const fn of listeners) await fn(bundle);
      },
      source: {
        forwardOnly,
        push: { verifyPushToken: jest.fn() },
        async start() {
          for (const fn of listeners) await fn(first);
        },
        onChange(fn: (b: ResolvedBundle) => Promise<void>) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        async keepBundle(bundle: ResolvedBundle) {
          kept.push(bundle);
        },
      },
    };
  };

  it('applies a newer pulled or pushed bundle from a forward-only source', async () => {
    const sync = makeSync();
    const { source, pull } = orderedSource(buildBundle({ version: '1.0.0' }), true);
    sync.attachSource(source);
    await sync.ensureLoaded();

    await pull(buildBundle({ version: '1.1.0' }));
    const pushed = await sync.applyPushed(buildBundle({ version: '2.0.0' }));

    expect(pushed).toMatchObject({ applied: true, bundleVersion: '2.0.0' });
    expect(sync.loadState()).toMatchObject({ bundleVersion: '2.0.0' });
  });

  it('refuses an older pulled bundle: the served one stays and stays kept, and the refusal is logged', async () => {
    const registry = new FakeRegistry();
    const sync = makeSync(registry);
    const { source, pull, kept } = orderedSource(buildBundle({ version: '2.0.0', generatedAt: EARLIER }), true);
    sync.attachSource(source);
    await sync.ensureLoaded();
    loggerMocks.warn.mockClear();

    await pull(buildBundle({ version: '1.9.0', generatedAt: LATER }));

    expect(sync.loadState()).toEqual({ status: 'loaded', bundleId: 'acme:prod', bundleVersion: '2.0.0' });
    expect(kept.map((bundle) => bundle.version)).toEqual(['2.0.0']);
    expect(registry.registered.map((skill) => skill.bundleVersion)).toEqual(['2.0.0']);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      `[bundle-sync] bundle acme:prod@1.9.0 not applied: older than the served bundle acme:prod@2.0.0 (generatedAt ${EARLIER})`,
    );
  });

  it('refuses an older pushed bundle as outdated', async () => {
    const sync = makeSync();
    sync.attachSource(orderedSource(buildBundle({ version: '3.0.0' }), true).source);

    const result = await sync.applyPushed(buildBundle({ version: '2.5.0' }));

    expect(result).toMatchObject({
      applied: false,
      refusal: 'outdated',
      bundleVersion: '2.5.0',
      reason: expect.stringContaining('older than the served bundle acme:prod@3.0.0'),
    });
    expect(sync.loadState()).toMatchObject({ bundleVersion: '3.0.0' });
  });

  it('applies the same version re-signed later, refuses it signed earlier, and applies the same bundle pulled again', async () => {
    const sync = makeSync();
    const { source, pull, kept } = orderedSource(buildBundle({ version: '2.0.0', generatedAt: EARLIER }), true);
    sync.attachSource(source);
    await sync.ensureLoaded();

    await pull(buildBundle({ version: '2.0.0', generatedAt: LATER }));
    const earlier = await sync.applyPushed(buildBundle({ version: '2.0.0', generatedAt: EARLIER }));
    const same = await sync.applyPushed(buildBundle({ version: '2.0.0', generatedAt: LATER }));

    expect(earlier).toMatchObject({ applied: false, refusal: 'outdated' });
    expect(same).toMatchObject({ applied: true });
    expect(kept.map((bundle) => bundle.generatedAt)).toEqual([EARLIER, LATER, LATER]);
  });

  it('orders versions that are not semver by generatedAt', async () => {
    const sync = makeSync();
    const { source, pull } = orderedSource(buildBundle({ version: '9', generatedAt: EARLIER }), true);
    sync.attachSource(source);
    await sync.ensureLoaded();

    await pull(buildBundle({ version: '10', generatedAt: LATER }));
    const generatedBefore = await sync.applyPushed(buildBundle({ version: '11', generatedAt: EARLIER }));

    expect(generatedBefore).toMatchObject({ applied: false, refusal: 'outdated' });
    expect(sync.loadState()).toMatchObject({ bundleVersion: '10' });
  });

  it('refuses a bundle whose generatedAt is not a date when the order depends on it', async () => {
    const sync = makeSync();
    sync.attachSource(orderedSource(buildBundle({ version: '2.0.0', generatedAt: EARLIER }), true).source);

    const result = await sync.applyPushed(buildBundle({ version: '2.0.0', generatedAt: 'not-a-date' }));

    expect(result).toMatchObject({ applied: false, refusal: 'outdated' });
    expect(sync.loadState()).toMatchObject({ bundleVersion: '2.0.0' });
  });

  it.each([
    ['allows a rollback', false],
    ['does not order its bundles, as the static and inline sources', undefined],
  ])('applies an older bundle from a source that %s', async (_label, forwardOnly) => {
    const sync = makeSync();
    const { source, pull, kept } = orderedSource(buildBundle({ version: '2.0.0' }), forwardOnly);
    sync.attachSource(source);
    await sync.ensureLoaded();

    await pull(buildBundle({ version: '1.0.0' }));
    const pushed = await sync.applyPushed(buildBundle({ version: '0.9.0' }));

    expect(pushed).toMatchObject({ applied: true, bundleVersion: '0.9.0' });
    expect(kept.map((bundle) => bundle.version)).toEqual(['2.0.0', '1.0.0', '0.9.0']);
  });

  it('checks the signature before the version, so a tampered older bundle is refused for its signature', async () => {
    const store = new BundleStore();
    store.swap(buildBundle({ version: '2.0.0' }));
    const sync = new BundleSyncService(
      new FakeRegistry() as unknown as SkillRegistryInterface,
      new HiddenOpRegistry(),
      store,
      { requireSignature: true, trustedKeys: [], exposeOperationsAsInternalTools: false },
      fakeLogger,
    );
    sync.attachSource(orderedSource(buildBundle({ version: '2.0.0' }), true).source);

    const result = await sync.apply(buildBundle({ version: '1.0.0' }));

    expect(result).toMatchObject({ applied: false, reason: 'bundle missing integrity envelope' });
    expect(result.refusal).toBeUndefined();
  });
});
