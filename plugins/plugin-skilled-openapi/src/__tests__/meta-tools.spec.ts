/**
 * Behavioral tests for the three meta-tools' execute() methods. We don't go
 * through the FrontMCP DI bootstrap here — we directly stub `this.get(Token)`
 * to inject the singletons the tools depend on. The runtime correctness of
 * search → load → execute_action is what's covered.
 */

import 'reflect-metadata';

import type { SkillContent } from '@frontmcp/sdk';

import { BundleStore } from '../bundle/bundle.store';
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
  // Resolve ScopeEntry by class name match — the tools' `this.get(ScopeEntry)`
  // call passes the class as the token; we register the scope under the same
  // identity here. The scope object is duck-typed (only `skills` is used).

  const { ScopeEntry } = require('@frontmcp/sdk') as any;
  map.set(ScopeEntry, scope);

  return {
    get<T>(token: { new (...args: never[]): T } | unknown): T {
      const v = map.get(token);
      if (v === undefined) {
        throw new Error(`mock get() missing token: ${(token as { name?: string })?.name ?? '<anonymous>'}`);
      }
      return v as T;
    },
    logger: fakeLogger,
    authInfo: args.authInfo ?? { user: { sub: 'u', roles: [], permissions: [] } },
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
});
