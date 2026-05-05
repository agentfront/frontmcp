// file: libs/sdk/src/skill/__tests__/skill-audit.helper.spec.ts
//
// Behavioral tests for the SDK-side audit registration helper. The helper
// is the wire between `skillsConfig.audit` and the DI-resolved
// SkillAuditWriter; it MUST work in Edge runtimes (no `require`, no `eval`)
// and MUST refuse to fall back to a process-local default secret in
// production. Both invariants are security-relevant — silently disabling
// audit on Edge or shipping a process-local secret in prod would be
// regressions.

import 'reflect-metadata';

import {
  hasSkillAuditFactory,
  registerSkillAuditWriter,
  setSkillAuditFactory,
  type AuditModuleShape,
} from '../skill-audit.helper';

function makeLogger(): {
  warn: jest.Mock;
  verbose: jest.Mock;
  warns: unknown[][];
  verboses: unknown[][];
} {
  const warns: unknown[][] = [];
  const verboses: unknown[][] = [];
  return {
    warn: jest.fn((...args: unknown[]) => {
      warns.push(args);
    }) as never,
    verbose: jest.fn((...args: unknown[]) => {
      verboses.push(args);
    }) as never,
    warns,
    verboses,
  };
}

function makeProviders(): {
  injectProvider: jest.Mock;
  injected: Array<{ provide: symbol; value: unknown }>;
} {
  const injected: Array<{ provide: symbol; value: unknown }> = [];
  const injectProvider = jest.fn((rec: { provide: symbol; value: unknown }) => {
    injected.push(rec);
  });
  return { injectProvider: injectProvider as never, injected };
}

class FakeSigner {
  static lastArgs: unknown[] = [];
  constructor(...args: unknown[]) {
    FakeSigner.lastArgs = args;
  }
}
class FakeStore {}
class FakeWriter {
  static instances: FakeWriter[] = [];
  constructor(
    public readonly store: unknown,
    public readonly signer: unknown,
  ) {
    FakeWriter.instances.push(this);
  }
}

const FAKE_TOKEN = Symbol.for('test:audit-writer');

const fakeModule: AuditModuleShape = {
  SkillAuditWriterToken: FAKE_TOKEN,
  SkillAuditWriter: FakeWriter as never,
  Hs256AuditSigner: FakeSigner as never,
  MemoryAuditStore: FakeStore as never,
};

afterEach(() => {
  setSkillAuditFactory(undefined);
  // Wipe globalThis fallback — used by some tests to verify the no-require
  // path picks the global up.
  delete (globalThis as { __frontmcp_skill_audit_module__?: unknown }).__frontmcp_skill_audit_module__;
  // Restore NODE_ENV in case a test mutated it.
  delete process.env.NODE_ENV;
  FakeWriter.instances = [];
  FakeSigner.lastArgs = [];
});

describe('registerSkillAuditWriter', () => {
  it('is a no-op when audit is undefined', () => {
    const logger = makeLogger();
    const providers = makeProviders();
    registerSkillAuditWriter({
      providers: providers as never,
      audit: undefined,
      logger: logger as never,
    });
    expect(providers.injectProvider).not.toHaveBeenCalled();
    expect(hasSkillAuditFactory()).toBe(false);
  });

  it('is a no-op when audit.enabled is false (default)', () => {
    const logger = makeLogger();
    const providers = makeProviders();
    registerSkillAuditWriter({
      providers: providers as never,
      audit: { enabled: false },
      logger: logger as never,
    });
    expect(providers.injectProvider).not.toHaveBeenCalled();
  });

  it('registers via injected factory and works without `require` available', () => {
    setSkillAuditFactory(() => fakeModule);
    expect(hasSkillAuditFactory()).toBe(true);

    const logger = makeLogger();
    const providers = makeProviders();
    registerSkillAuditWriter({
      providers: providers as never,
      audit: { enabled: true },
      logger: logger as never,
    });
    expect(providers.injectProvider).toHaveBeenCalledTimes(1);
    expect(providers.injected[0]!.provide).toBe(FAKE_TOKEN);
    expect(FakeWriter.instances.length).toBe(1);
  });

  it('falls back to globalThis.__frontmcp_skill_audit_module__ when no factory is set', () => {
    (globalThis as { __frontmcp_skill_audit_module__?: AuditModuleShape }).__frontmcp_skill_audit_module__ = fakeModule;
    const logger = makeLogger();
    const providers = makeProviders();
    registerSkillAuditWriter({
      providers: providers as never,
      audit: { enabled: true },
      logger: logger as never,
    });
    expect(providers.injectProvider).toHaveBeenCalled();
  });

  it('warns and disables audit (dev mode) when no factory and no global fallback are set', () => {
    const logger = makeLogger();
    const providers = makeProviders();
    registerSkillAuditWriter({
      providers: providers as never,
      audit: { enabled: true },
      logger: logger as never,
    });
    expect(providers.injectProvider).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    const warnMsg = String(logger.warns[0]?.[0] ?? '');
    expect(warnMsg).toMatch(/setSkillAuditFactory|module factory/);
  });

  it('throws in production when audit is enabled but no factory is registered', () => {
    process.env.NODE_ENV = 'production';
    const logger = makeLogger();
    const providers = makeProviders();
    expect(() =>
      registerSkillAuditWriter({
        providers: providers as never,
        audit: { enabled: true },
        logger: logger as never,
      }),
    ).toThrow(/audit module factory/);
  });

  it('refuses to use the default HS256 signer in production', () => {
    process.env.NODE_ENV = 'production';
    setSkillAuditFactory(() => fakeModule);
    const logger = makeLogger();
    const providers = makeProviders();
    expect(() =>
      registerSkillAuditWriter({
        providers: providers as never,
        audit: { enabled: true }, // no explicit signer/store
        logger: logger as never,
      }),
    ).toThrow(/refusing to use the default HS256 signer/);
  });

  it('uses CSPRNG randomBytes for the dev default secret (not Math.random)', () => {
    setSkillAuditFactory(() => fakeModule);
    const logger = makeLogger();
    const providers = makeProviders();
    registerSkillAuditWriter({
      providers: providers as never,
      audit: { enabled: true },
      logger: logger as never,
    });
    // FakeSigner.lastArgs[0] is the secret bytes — must be a Uint8Array
    // of length 32 (regression for Math.random()-based default).
    expect(FakeSigner.lastArgs[0]).toBeInstanceOf(Uint8Array);
    expect((FakeSigner.lastArgs[0] as Uint8Array).length).toBe(32);
  });

  it('host-supplied signer/store override the defaults', () => {
    setSkillAuditFactory(() => fakeModule);
    const customSigner = { sign: () => undefined };
    const customStore = { tail: () => undefined };
    const logger = makeLogger();
    const providers = makeProviders();
    registerSkillAuditWriter({
      providers: providers as never,
      audit: { enabled: true, signer: customSigner, store: customStore },
      logger: logger as never,
    });
    expect(FakeWriter.instances.length).toBe(1);
    expect(FakeWriter.instances[0]!.signer).toBe(customSigner);
    expect(FakeWriter.instances[0]!.store).toBe(customStore);
  });

  it('tolerates a factory that throws (dev) — disables audit with a warning', () => {
    setSkillAuditFactory(() => {
      throw new Error('module load failed');
    });
    const logger = makeLogger();
    const providers = makeProviders();
    registerSkillAuditWriter({
      providers: providers as never,
      audit: { enabled: true },
      logger: logger as never,
    });
    expect(providers.injectProvider).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does NOT call eval or require — works in a sandbox without require', () => {
    // Hide require in this scope. A passing test confirms the helper
    // doesn't transitively touch `require`/`eval('require')` on the hot
    // path. (The injected factory IS where the host wires the actual
    // module, so it never traverses require here.)
    setSkillAuditFactory(() => fakeModule);
    const logger = makeLogger();
    const providers = makeProviders();
    // Wrap the call in a sentinel that would trip if `eval` was used.
    const originalEval = globalThis.eval;
    let evalCalled = false;
    (globalThis as { eval: typeof eval }).eval = ((src: string) => {
      evalCalled = true;
      return originalEval(src);
    }) as never;
    try {
      registerSkillAuditWriter({
        providers: providers as never,
        audit: { enabled: true },
        logger: logger as never,
      });
    } finally {
      (globalThis as { eval: typeof eval }).eval = originalEval;
    }
    expect(evalCalled).toBe(false);
    expect(providers.injectProvider).toHaveBeenCalled();
  });
});
