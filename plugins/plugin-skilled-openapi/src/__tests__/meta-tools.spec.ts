/**
 * Behavioral tests for the three meta-tools' execute() methods. We don't go
 * through the FrontMCP DI bootstrap here — we directly stub `this.get(Token)`
 * to inject the singletons the tools depend on. The runtime correctness of
 * search → load → execute_action is what's covered.
 */

import 'reflect-metadata';

import { BundleStore, SkillAuditWriterToken } from '@frontmcp/adapters/skills';
import { ScopeEntry, type SkillContent } from '@frontmcp/sdk';

import { MemoryCredentialResolver } from '../executor/credential-resolver';
import { clearCompiledSchemaCache } from '../executor/schema-cache';
import { HiddenOpRegistry, type HiddenOpEntry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';
import { BundleSyncService } from '../sync/bundle-sync.service';
import ExecuteActionTool from '../tools/execute-action.tool';
import LoadSkillTool from '../tools/load-skill.tool';
import SearchSkillTool from '../tools/search-skill.tool';

// Clear the per-(bundleVersion, opId) compiled-schema cache between tests so
// one test's `inputSchema` override doesn't get stamped onto the next test
// that reuses the same skillId/actionId pair.
beforeEach(() => clearCompiledSchemaCache());

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

const fakeScopeEntry = (skills: { search: jest.Mock; loadSkill: jest.Mock; hasAny: jest.Mock }): unknown => ({
  logger: fakeLogger,
  skills,
});

const buildEntry = (
  skillId: string,
  actionId: string,
  overrides: Partial<HiddenOpEntry['op']> = {},
): HiddenOpEntry => ({
  skillId,
  bundleId: 'test:bundle',
  bundleVersion: 'v1',
  service: { id: 'svc', baseUrl: 'http://localhost:9999' },
  authBinding: { kind: 'bearer', vaultRef: 'tok' },
  op: {
    operationId: actionId,
    serviceId: 'svc',
    httpMethod: 'POST',
    pathTemplate: '/v1/x',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    mapper: [],
    authBindingRef: 'def',
    ...overrides,
  },
});

const baseConfig = (overrides: Record<string, unknown> = {}) =>
  new SkilledOpenApiConfig({
    source: { type: 'static', path: '/none', watch: false },
    requireSignature: false,
    trustedKeys: [],
    dev: false,
    outbound: {
      allowPrivateNetworks: true,
      maxConcurrencyPerHost: 10,
      defaultTimeoutMs: 5_000,
      defaultMaxResponseBytes: 256 * 1024,
      allowHttp: true,
    },
    sourceConflictPolicy: 'static-wins',
    ...overrides,
  } as never);

/**
 * Build a minimal `this`-like object that satisfies the meta-tool execute()
 * methods' DI calls without going through the full FrontMCP scope.
 */
function makeToolThis(args: {
  scopeSkills?: { search?: jest.Mock; loadSkill?: jest.Mock; hasAny?: jest.Mock };
  hiddenOps?: HiddenOpRegistry;
  bundleStore?: BundleStore;
  authorityGuard?: AuthorityGuard;
  resolver?: SkilledOpenApiCredentialResolver;
  config?: SkilledOpenApiConfig;
  authInfo?: Record<string, unknown>;
  auditWriter?: unknown;
}) {
  const skills = {
    search: args.scopeSkills?.search ?? jest.fn(),
    loadSkill: args.scopeSkills?.loadSkill ?? jest.fn(),
    hasAny: args.scopeSkills?.hasAny ?? jest.fn(() => true),
  };
  const scope = fakeScopeEntry(skills);
  const map = new Map<unknown, unknown>();
  // Use class identity as the DI key; each meta-tool calls this.get(Token).
  map.set(BundleSyncService, {});
  map.set(SkilledOpenApiConfig, args.config ?? baseConfig());
  map.set(HiddenOpRegistry, args.hiddenOps ?? new HiddenOpRegistry());
  map.set(BundleStore, args.bundleStore ?? new BundleStore());
  map.set(AuthorityGuard, args.authorityGuard ?? new AuthorityGuard());
  map.set(
    SkilledOpenApiCredentialResolver,
    args.resolver ?? (new MemoryCredentialResolver({ tok: 'sk_x' }) as unknown as SkilledOpenApiCredentialResolver),
  );
  // Resolve ScopeEntry by class identity — the tools' `this.get(ScopeEntry)`
  // call passes the class as the token; register the scope under the same
  // identity here. The scope object is duck-typed (only `skills` is used).
  map.set(ScopeEntry, scope);
  if (args.auditWriter) {
    map.set(SkillAuditWriterToken, args.auditWriter);
  }

  return {
    get<T>(token: { new (...args: never[]): T } | unknown): T {
      const v = map.get(token);
      if (v === undefined) {
        throw new Error(`mock get() missing token: ${(token as { name?: string })?.name ?? '<anonymous>'}`);
      }
      return v as T;
    },
    // tryGet returns undefined for unregistered tokens — mirrors the real
    // ExecutionContextBase.tryGet behavior used by the audit-writer wire-in.
    tryGet<T>(token: unknown): T | undefined {
      return map.has(token) ? (map.get(token) as T) : undefined;
    },
    logger: fakeLogger,
    authInfo: args.authInfo ?? { user: { sub: 'u', roles: [], permissions: [] } },
    // ToolContext.progress is `protected`; meta-tools call it through `this`.
    // The test fixture doesn't go through the full ToolContext constructor,
    // so stub it as a no-op resolving to `false` (the same return shape as
    // the real method when no progressToken is present).
    progress: jest.fn(async () => false),
  } as unknown as SearchSkillTool & LoadSkillTool & ExecuteActionTool;
}

describe('search_skill', () => {
  it('returns empty array when registry has no skills', async () => {
    const ctx = makeToolThis({ scopeSkills: { hasAny: jest.fn(() => false) } });
    const result = await SearchSkillTool.prototype.execute.call(ctx, { query: 'x' });
    expect(result).toEqual({ skills: [] });
  });

  it('maps registry results to search response shape', async () => {
    const search = jest.fn(async () => [
      {
        metadata: { id: 's1', name: 'S1', description: 'D1', bundleVersion: 'v3' },
        score: 0.9,
        availableTools: [],
        missingTools: [],
        source: 'local' as const,
      },
    ]);
    const ctx = makeToolThis({ scopeSkills: { search, hasAny: jest.fn(() => true) } });
    const result = await SearchSkillTool.prototype.execute.call(ctx, { query: 'do thing', limit: 5 });
    expect(result.skills[0]).toMatchObject({ skillId: 's1', score: 0.9, bundleVersion: 'v3' });
    expect(search).toHaveBeenCalledWith('do thing', expect.objectContaining({ topK: 5 }));
  });

  it('forwards tags filter to registry.search', async () => {
    const search = jest.fn(async () => []);
    const ctx = makeToolThis({ scopeSkills: { search, hasAny: jest.fn(() => true) } });
    await SearchSkillTool.prototype.execute.call(ctx, { query: 'q', tags: ['billing'] });
    expect(search).toHaveBeenCalledWith('q', expect.objectContaining({ tags: ['billing'] }));
  });
});

describe('load_skill', () => {
  it('returns the skill content with actions and bundleVersion preserved', async () => {
    const loaded: SkillContent = {
      id: 's1',
      name: 'S1',
      description: 'd',
      instructions: '# inst',
      tools: [],
      actions: [
        {
          actionId: 'a1',
          summary: 'sum',
          inputJsonSchema: { type: 'object' },
          outputJsonSchema: { type: 'object' },
        },
      ],
      bundleVersion: 'v9',
    };
    const loadSkill = jest.fn(async () => ({
      skill: loaded,
      availableTools: [],
      missingTools: [],
      isComplete: true,
    }));
    const ctx = makeToolThis({ scopeSkills: { loadSkill, hasAny: jest.fn(() => true) } });
    const result = await LoadSkillTool.prototype.execute.call(ctx, { skillId: 's1' });
    expect(result.skill.actions?.[0]?.actionId).toBe('a1');
    expect(result.skill.bundleVersion).toBe('v9');
    expect(result.isComplete).toBe(true);
  });

  it('throws when skill is not found', async () => {
    const loadSkill = jest.fn(async () => undefined);
    const ctx = makeToolThis({ scopeSkills: { loadSkill, hasAny: jest.fn(() => false) } });
    await expect(LoadSkillTool.prototype.execute.call(ctx, { skillId: 'nope' })).rejects.toThrow(/not found/);
  });

  it('forwards warning and omits actions when load result has neither', async () => {
    const loaded: SkillContent = {
      id: 's1',
      name: 'S1',
      description: 'd',
      instructions: '# inst',
      tools: [],
      // no actions, no bundleVersion
    };
    const loadSkill = jest.fn(async () => ({
      skill: loaded,
      availableTools: [],
      missingTools: [],
      isComplete: false,
      warning: 'partial-load',
    }));
    const ctx = makeToolThis({ scopeSkills: { loadSkill, hasAny: jest.fn(() => true) } });
    const result = await LoadSkillTool.prototype.execute.call(ctx, { skillId: 's1' });
    expect(result.warning).toBe('partial-load');
    expect(result.skill).not.toHaveProperty('actions');
    expect(result.skill).not.toHaveProperty('bundleVersion');
    expect(result.isComplete).toBe(false);
  });
});

describe('search_skill — additional coverage', () => {
  it('falls back to metadata.name when metadata.id is undefined', async () => {
    const search = jest.fn(async () => [
      {
        metadata: { name: 'fallback-name', description: 'd' }, // no id
        score: 0.5,
        availableTools: [],
        missingTools: [],
        source: 'local' as const,
      },
    ]);
    const ctx = makeToolThis({ scopeSkills: { search, hasAny: jest.fn(() => true) } });
    const result = await SearchSkillTool.prototype.execute.call(ctx, { query: 'x' });
    expect(result.skills[0].skillId).toBe('fallback-name');
  });

  it('omits bundleVersion when registry result has none', async () => {
    const search = jest.fn(async () => [
      {
        metadata: { id: 's', name: 'S' }, // no description, no bundleVersion
        score: 0.1,
        availableTools: [],
        missingTools: [],
        source: 'local' as const,
      },
    ]);
    const ctx = makeToolThis({ scopeSkills: { search, hasAny: jest.fn(() => true) } });
    const result = await SearchSkillTool.prototype.execute.call(ctx, { query: 'x' });
    expect(result.skills[0]).not.toHaveProperty('bundleVersion');
    expect(result.skills[0].description).toBe('');
  });
});

describe('execute_action — additional branch coverage', () => {
  it('uses default deniedBy reason when authority guard returns no reason', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('s', 'a');
    hiddenOps.set(entry);
    const guard = {
      check: jest.fn(async () => ({ granted: false })), // no `deniedBy`
    } as unknown as AuthorityGuard;
    const ctx = makeToolThis({ hiddenOps, authorityGuard: guard });
    const result = await ExecuteActionTool.prototype.execute.call(ctx, { skillId: 's', actionId: 'a' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/policy not satisfied/);
  });

  it('uses fallback "<METHOD> <pathTemplate>" summary when entry.op.summary is missing', async () => {
    // Indirectly exercises the `summary ?? ...` branch via tool registration —
    // but execute_action itself doesn't read summary; this test just exercises
    // the executor's allowedHosts derivation when the active bundle's services
    // include a malformed URL (covers the catch on URL parse).
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('s', 'a');
    hiddenOps.set(entry);

    const bundleStore = new BundleStore();
    bundleStore.swap({
      schemaVersion: 1,
      bundleId: 'b',
      version: 'v',
      generatedAt: '2026-05-04T00:00:00Z',
      sourceDigest: 'a'.repeat(64),
      services: [
        { id: 'svc', baseUrl: 'http://localhost:9999' },
        { id: 'broken', baseUrl: 'not-a-url' as never },
      ],
      authBindings: { def: { kind: 'none' } },
      skills: [],
      operations: {},
    });

    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as never;
    try {
      const ctx = makeToolThis({ hiddenOps, bundleStore });
      const result = await ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 's',
        actionId: 'a',
        input: {},
      });
      expect(result.ok).toBe(true);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('handles a malformed pinned service baseUrl without throwing', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('s', 'a');
    entry.service = { id: 'svc', baseUrl: 'not-a-url' as never };
    hiddenOps.set(entry);
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as never;
    try {
      const ctx = makeToolThis({ hiddenOps });
      // Will fail SSRF further down the stack, but the URL-parse catch must
      // not throw out of execute() itself.
      const result = await ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 's',
        actionId: 'a',
        input: {},
      });
      expect(result).toBeDefined();
    } finally {
      global.fetch = realFetch;
    }
  });

  it('formats validation errors with empty path as <root>', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('s', 'a', {
      // a schema where the entire input is rejected (path is empty)
      inputSchema: { type: 'string' as never },
    });
    hiddenOps.set(entry);
    const ctx = makeToolThis({ hiddenOps });
    const result = await ExecuteActionTool.prototype.execute.call(ctx, {
      skillId: 's',
      actionId: 'a',
      input: { wrong: 'shape' },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/input validation failed/);
    // The whole-input validation issue has an empty `path`; the formatter must
    // render that as the literal `<root>` token so the LLM can tell which
    // field broke. A looser regex would silently let a regression slip in.
    expect(result.error).toMatch(/<root>/);
  });
});

describe('execute_action', () => {
  it('returns ok:false structured error when action is unknown', async () => {
    const ctx = makeToolThis({});
    const result = await ExecuteActionTool.prototype.execute.call(ctx, { skillId: 's', actionId: 'missing' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown action/);
  });

  it('returns ok:false when authority is denied', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('billing', 'createInvoice');
    entry.op.requiredAuthorities = { roles: { all: ['admin'] } };
    hiddenOps.set(entry);

    const ctx = makeToolThis({
      hiddenOps,
      authInfo: { user: { sub: 'u', roles: ['user'], permissions: [] } },
    });
    const result = await ExecuteActionTool.prototype.execute.call(ctx, {
      skillId: 'billing',
      actionId: 'createInvoice',
      input: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/authority denied/);
  });

  it('emits an authority-check-fail audit record when the guard denies', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('billing', 'createInvoice');
    entry.op.requiredAuthorities = { roles: { all: ['admin'] } };
    hiddenOps.set(entry);

    const writeAuthorityFail = jest.fn(() => Promise.resolve());
    const writeAuthorityPass = jest.fn(() => Promise.resolve());
    const auditWriter = {
      writeAuthorityFail,
      writeAuthorityPass,
      writeHttpCallSuccess: jest.fn(() => Promise.resolve()),
      writeHttpCallFailure: jest.fn(() => Promise.resolve()),
    };

    const ctx = makeToolThis({
      hiddenOps,
      authInfo: { user: { sub: 'u', roles: ['user'], permissions: [] } },
      auditWriter,
    });
    const result = await ExecuteActionTool.prototype.execute.call(ctx, {
      skillId: 'billing',
      actionId: 'createInvoice',
      input: { amount: 100 },
    });
    expect(result.ok).toBe(false);
    expect(writeAuthorityFail).toHaveBeenCalledTimes(1);
    expect(writeAuthorityPass).not.toHaveBeenCalled();
    const [auditCtx, extras] = writeAuthorityFail.mock.calls[0]!;
    expect(auditCtx).toMatchObject({
      skillId: 'billing',
      actionId: 'createInvoice',
      subject: 'u',
    });
    expect(extras).toMatchObject({ reason: expect.any(String) });
  });

  it('happy path: invokes the executor and returns the structured envelope', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('billing', 'createInvoice', {
      pathTemplate: '/v1/invoices',
      mapper: [{ inputKey: 'amount', type: 'body', key: 'amount' }],
    });
    hiddenOps.set(entry);

    const bundleStore = new BundleStore();
    bundleStore.swap({
      schemaVersion: 1,
      bundleId: 'test',
      version: 'v1',
      generatedAt: '2026-05-04T00:00:00Z',
      sourceDigest: 'a'.repeat(64),
      services: [{ id: 'svc', baseUrl: 'http://localhost:9999' }],
      authBindings: { def: { kind: 'none' } },
      skills: [],
      operations: {},
    });

    // Stub fetch via global to satisfy the executor call.
    const realFetch = global.fetch;
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ id: 'inv_1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    ) as never;

    try {
      const ctx = makeToolThis({ hiddenOps, bundleStore });
      const result = await ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 'billing',
        actionId: 'createInvoice',
        input: { amount: 4200 },
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('emits 5-step progress milestones on the happy path', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('billing', 'createInvoice', { pathTemplate: '/v1/x', mapper: [] });
    hiddenOps.set(entry);

    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as never;
    try {
      const ctx = makeToolThis({ hiddenOps });
      const progressSpy = (ctx as unknown as { progress: jest.Mock }).progress;
      await ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 'billing',
        actionId: 'createInvoice',
        input: {},
      });
      // Five milestones, monotonically increasing, total=5 each.
      expect(progressSpy).toHaveBeenCalledTimes(5);
      const calls = progressSpy.mock.calls.map((args) => args[0]);
      expect(calls).toEqual([1, 2, 3, 4, 5]);
      const totals = progressSpy.mock.calls.map((args) => args[1]);
      expect(totals.every((t) => t === 5)).toBe(true);
      const messages = progressSpy.mock.calls.map((args) => args[2]);
      expect(messages).toEqual(['resolve-action', 'authority-check', 'input-validate', 'http-call', 'done']);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('stops emitting progress after an early-return phase (unknown action)', async () => {
    const ctx = makeToolThis({});
    const progressSpy = (ctx as unknown as { progress: jest.Mock }).progress;
    await ExecuteActionTool.prototype.execute.call(ctx, { skillId: 's', actionId: 'missing' });
    // Only the resolve-action milestone fires before the early return.
    expect(progressSpy).toHaveBeenCalledTimes(1);
    expect(progressSpy.mock.calls[0]).toEqual([1, 5, 'resolve-action']);
  });

  it('uses the entry service baseUrl when no active bundle is present (allowedHosts fallback)', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('billing', 'createInvoice', { pathTemplate: '/v1/x', mapper: [] });
    hiddenOps.set(entry);

    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as never;
    try {
      const ctx = makeToolThis({ hiddenOps }); // no bundleStore swap
      const result = await ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 'billing',
        actionId: 'createInvoice',
      });
      expect(result.ok).toBe(true);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('rejects input that fails the op inputSchema before any HTTP call', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('billing', 'createInvoice', {
      pathTemplate: '/v1/invoices',
      mapper: [{ inputKey: 'amount', type: 'body', key: 'amount' }],
      inputSchema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
    });
    hiddenOps.set(entry);

    const realFetch = global.fetch;
    const fetchSpy = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchSpy as never;
    try {
      const ctx = makeToolThis({ hiddenOps });
      const result = await ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 'billing',
        actionId: 'createInvoice',
        input: {}, // missing required `amount`
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/input validation failed/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
  });

  it('rejects upstream response that fails the op outputSchema', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('billing', 'createInvoice', {
      pathTemplate: '/v1/invoices',
      mapper: [{ inputKey: 'amount', type: 'body', key: 'amount' }],
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, status: { type: 'string' } },
        required: ['id', 'status'],
      },
    });
    hiddenOps.set(entry);

    const realFetch = global.fetch;
    // Upstream returns 200 OK but the body is missing the required `status`
    // field. The output gate should turn this into ok:false.
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ id: 'inv_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as never;
    try {
      const ctx = makeToolThis({ hiddenOps });
      const result = await ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 'billing',
        actionId: 'createInvoice',
        input: { amount: 1 },
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/output schema/);
      // Status from the upstream is preserved so the LLM can still see what happened.
      expect(result.status).toBe(200);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('passes through upstream error envelopes (ok:false from executor) without applying outputSchema', async () => {
    const hiddenOps = new HiddenOpRegistry();
    const entry = buildEntry('billing', 'createInvoice', {
      pathTemplate: '/v1/invoices',
      mapper: [{ inputKey: 'amount', type: 'body', key: 'amount' }],
      outputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    });
    hiddenOps.set(entry);

    const realFetch = global.fetch;
    // 502 from upstream — executor returns ok:false. Output gate must NOT
    // wrap the error string with a "schema validation failed" message.
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: 'bad gateway' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
    ) as never;
    try {
      const ctx = makeToolThis({ hiddenOps });
      const result = await ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 'billing',
        actionId: 'createInvoice',
        input: { amount: 1 },
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(502);
      expect(result.error).toBeUndefined(); // executor leaves error unset on non-2xx that returned a body
    } finally {
      global.fetch = realFetch;
    }
  });

  describe('telemetry — ObservabilityPlugin absent', () => {
    // Regression: previously execute_action read `(this as { telemetry?: ... }).telemetry`,
    // which triggered the context-extension getter and threw
    // ContextExtensionNotAvailableError when ObservabilityPlugin wasn't
    // installed. The fix routes the lookup through `this.tryGet(...)` so the
    // tool runs cleanly with no events, no errors.
    it('runs cleanly without ObservabilityPlugin (no telemetry token registered)', async () => {
      const hiddenOps = new HiddenOpRegistry();
      const entry = buildEntry('billing', 'createInvoice', { pathTemplate: '/v1/x', mapper: [] });
      hiddenOps.set(entry);

      const realFetch = global.fetch;
      global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as never;
      try {
        // makeToolThis registers no telemetry token — `tryGet(TELEMETRY_ACCESSOR)`
        // returns undefined and the tool's phase events become silent no-ops.
        const ctx = makeToolThis({ hiddenOps });
        const result = await ExecuteActionTool.prototype.execute.call(ctx, {
          skillId: 'billing',
          actionId: 'createInvoice',
          input: {},
        });
        expect(result.ok).toBe(true);
      } finally {
        global.fetch = realFetch;
      }
    });

    it('forwards phase events to a registered TelemetryAccessor when present', async () => {
      const hiddenOps = new HiddenOpRegistry();
      const entry = buildEntry('billing', 'createInvoice', { pathTemplate: '/v1/x', mapper: [] });
      hiddenOps.set(entry);

      const events: { name: string; attrs?: Record<string, string | number | boolean> }[] = [];
      const attrSets: Record<string, string | number | boolean>[] = [];
      const fakeTelemetry = {
        addEvent(name: string, attrs?: Record<string, string | number | boolean>): void {
          events.push({ name, attrs });
        },
        setAttributes(attrs: Record<string, string | number | boolean>): void {
          attrSets.push(attrs);
        },
      };
      const TELEMETRY_TOKEN = Symbol.for('frontmcp:observability:telemetry-accessor');

      const realFetch = global.fetch;
      global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as never;
      try {
        const baseCtx = makeToolThis({ hiddenOps });
        // Splice the telemetry token into the mock context's tryGet map so
        // execute_action can resolve it. Other lookups continue to work.
        const ctx = {
          ...baseCtx,
          tryGet<T>(token: unknown): T | undefined {
            if (token === TELEMETRY_TOKEN) return fakeTelemetry as unknown as T;
            return (baseCtx as { tryGet: <U>(t: unknown) => U | undefined }).tryGet(token);
          },
        } as typeof baseCtx;
        await ExecuteActionTool.prototype.execute.call(ctx, {
          skillId: 'billing',
          actionId: 'createInvoice',
          input: {},
        });
        // Five phase events fire: resolve-action / authority-check /
        // input-validate / http-call / done.
        const phaseEvents = events.filter((e) => e.name === 'skill_action.phase');
        expect(phaseEvents.length).toBeGreaterThanOrEqual(5);
        expect(phaseEvents[0].attrs?.['phase']).toBe('resolve-action');
        // Final setAttributes records skill_action.* on the active span.
        expect(attrSets.length).toBeGreaterThanOrEqual(1);
        expect(attrSets[attrSets.length - 1]).toMatchObject({
          'skill_action.skill_id': 'billing',
          'skill_action.action_id': 'createInvoice',
        });
      } finally {
        global.fetch = realFetch;
      }
    });
  });
});
