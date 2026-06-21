/**
 * Behavioral tests for the three meta-tools' execute() methods. We don't go
 * through the FrontMCP DI bootstrap here — we directly stub `this.get(Token)`
 * to inject the singletons the tools depend on. The runtime correctness of
 * search → load is what's covered (execute is covered by execute-skill-action.spec.ts).
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
  } as unknown as SearchSkillTool & LoadSkillTool;
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

  it('forwards the anti-query (notQuery) and demotion weight (notWeight) to the registry', async () => {
    const search = jest.fn(async () => []);
    const ctx = makeToolThis({ scopeSkills: { search, hasAny: jest.fn(() => true) } });
    await SearchSkillTool.prototype.execute.call(ctx, {
      query: 'rate limiting',
      tags: ['guidance'],
      notQuery: 'enforcement',
      notWeight: 3,
    });
    expect(search).toHaveBeenCalledWith(
      'rate limiting',
      expect.objectContaining({
        tags: ['guidance'],
        negativeQuery: 'enforcement',
        negativeWeight: 3,
      }),
    );
  });
});
