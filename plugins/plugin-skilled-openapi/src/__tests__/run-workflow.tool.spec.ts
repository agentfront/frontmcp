/**
 * Behavioral tests for the `run_workflow` meta-tool's execute() method. As with
 * meta-tools.spec.ts we don't go through the FrontMCP DI bootstrap — we stub
 * `this.get(Token)` / `this.tryGet(Token)` to inject the singletons the tool
 * depends on, and we mock the OPTIONAL `@enclave-vm` sandbox + the
 * `executeSkillAction` bridge so the orchestration branches are exercised
 * without a real interpreter or outbound HTTP.
 */
import 'reflect-metadata';

import { SkillAuditWriterToken } from '@frontmcp/adapters/skills';

import { HiddenOpRegistry, type HiddenOpEntry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';
import { BundleSyncService } from '../sync/bundle-sync.service';
// eslint-disable-next-line import/first -- must import AFTER the jest.mock calls above
import RunWorkflowTool from '../tools/run-workflow.tool';

// ── Controllable mocks (factories may only reference `mock`-prefixed vars) ──

type FakeStats = { duration: number; toolCallCount: number; iterationCount: number };
type FakeResult = { success: boolean; value?: unknown; error?: { message: string }; stats: FakeStats };
type FakeCtx = { toolHandler: (actionId: string, input: Record<string, unknown>) => Promise<unknown> };

let mockTransformImpl: (code: string, cfg?: { transformLoops?: boolean }) => string;
let mockExecuteImpl: (code: string, ctx: FakeCtx) => Promise<FakeResult>;
// When set, the mocked `@enclave-vm/core/worker` module throws on (re)load,
// simulating the optional sandbox peer being absent. Re-evaluated only after
// resetModules. We gate the throw on core/worker (NOT ast) because @frontmcp/utils
// imports @enclave-vm/ast at module load, so a throwing ast mock would break the
// whole import chain instead of just the tool's lazy sandbox import.
let mockEnclaveCoreThrows = false;

jest.mock('@enclave-vm/ast', () => ({
  transformAgentScript: (code: string, cfg?: { transformLoops?: boolean }) => mockTransformImpl(code, cfg),
}));
jest.mock('@enclave-vm/core/worker', () => {
  if (mockEnclaveCoreThrows) throw new Error('Cannot find module @enclave-vm/core/worker');
  return {
    InterpreterAdapter: class {
      constructor(_opts: unknown) {}
      execute(code: string, ctx: unknown): Promise<FakeResult> {
        return mockExecuteImpl(code, ctx as FakeCtx);
      }
    },
  };
});

const mockExecuteSkillAction = jest.fn();
jest.mock('../executor/execute-skill-action', () => ({
  executeSkillAction: (...args: unknown[]) => mockExecuteSkillAction(...args),
}));

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

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

const buildEntry = (skillId: string, actionId: string): HiddenOpEntry => ({
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
  },
});

function makeRunWorkflowThis(
  args: {
    hiddenOps?: HiddenOpRegistry;
    authInfo?: Record<string, unknown>;
    auditWriter?: unknown;
    config?: SkilledOpenApiConfig;
    omitAuthInfo?: boolean;
  } = {},
) {
  const resolver = { resolve: jest.fn(async () => ({ token: 'sk_x' })) };
  const map = new Map<unknown, unknown>();
  // run_workflow `await`s ensureReady() before resolving actions; the hidden-op
  // registry here is pre-seeded, so the sync is a no-op in this unit test.
  map.set(BundleSyncService, { ensureReady: async () => {} });
  map.set(SkilledOpenApiConfig, args.config ?? baseConfig());
  map.set(HiddenOpRegistry, args.hiddenOps ?? new HiddenOpRegistry());
  map.set(AuthorityGuard, new AuthorityGuard());
  map.set(SkilledOpenApiCredentialResolver, resolver as unknown as SkilledOpenApiCredentialResolver);
  if (args.auditWriter) map.set(SkillAuditWriterToken, args.auditWriter);

  return {
    get<T>(token: unknown): T {
      const v = map.get(token);
      if (v === undefined) {
        throw new Error(`mock get() missing token: ${(token as { name?: string })?.name ?? '<anonymous>'}`);
      }
      return v as T;
    },
    tryGet<T>(token: unknown): T | undefined {
      return map.has(token) ? (map.get(token) as T) : undefined;
    },
    logger: fakeLogger,
    authInfo: args.omitAuthInfo ? undefined : (args.authInfo ?? { user: { sub: 'u', roles: [], permissions: [] } }),
  } as unknown as RunWorkflowTool;
}

const run = (ctx: RunWorkflowTool, script: string) => RunWorkflowTool.prototype.execute.call(ctx, { script });

beforeEach(() => {
  jest.clearAllMocks();
  mockEnclaveCoreThrows = false;
  // Defaults: passthrough transform; a successful no-tool-call run.
  mockTransformImpl = (code) => code;
  mockExecuteImpl = async () => ({
    success: true,
    value: 'done',
    stats: { duration: 5, toolCallCount: 0, iterationCount: 3 },
  });
});

describe('run_workflow', () => {
  it('returns success + mapped stats for a completed workflow', async () => {
    const ctx = makeRunWorkflowThis();
    const res = await run(ctx, 'return 1');
    expect(res).toEqual({
      success: true,
      value: 'done',
      stats: { durationMs: 5, toolCalls: 0, steps: 3 },
    });
  });

  it('passes transformLoops:false to the AgentScript transform', async () => {
    const seen: Array<{ transformLoops?: boolean } | undefined> = [];
    mockTransformImpl = (code, cfg) => {
      seen.push(cfg);
      return code;
    };
    await run(makeRunWorkflowThis(), 'return 1');
    expect(seen[0]).toEqual({ transformLoops: false });
  });

  it('returns failure when AgentScript is rejected (Error)', async () => {
    mockTransformImpl = () => {
      throw new Error('forbidden token');
    };
    const res = await run(makeRunWorkflowThis(), 'eval("x")');
    expect(res.success).toBe(false);
    expect(res.error).toBe('AgentScript rejected: forbidden token');
  });

  it('returns failure when AgentScript transform throws a non-Error', async () => {
    mockTransformImpl = () => {
      throw 'plain string blow-up';
    };
    const res = await run(makeRunWorkflowThis(), 'bad');
    expect(res.success).toBe(false);
    expect(res.error).toBe('AgentScript rejected: plain string blow-up');
  });

  it('surfaces a failed workflow run with its error message + stats', async () => {
    mockExecuteImpl = async () => ({
      success: false,
      error: { message: 'boom at step 4' },
      stats: { duration: 7, toolCallCount: 1, iterationCount: 9 },
    });
    const res = await run(makeRunWorkflowThis(), 'return 1');
    expect(res).toEqual({
      success: false,
      error: 'boom at step 4',
      stats: { durationMs: 7, toolCalls: 1, steps: 9 },
    });
  });

  it('falls back to a generic message when a failed run has no error', async () => {
    mockExecuteImpl = async () => ({
      success: false,
      stats: { duration: 0, toolCallCount: 0, iterationCount: 0 },
    });
    const res = await run(makeRunWorkflowThis(), 'return 1');
    expect(res.success).toBe(false);
    expect(res.error).toBe('workflow failed');
  });

  it('callTool bridge resolves a loaded action and returns its data', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'createInvoice'));
    mockExecuteSkillAction.mockResolvedValue({ ok: true, status: 200, data: { id: 'inv_1' } });

    let bridged: unknown;
    mockExecuteImpl = async (_code, ctx) => {
      bridged = await ctx.toolHandler('createInvoice', { amount: 10 });
      return { success: true, value: bridged, stats: { duration: 1, toolCallCount: 1, iterationCount: 1 } };
    };

    const res = await run(makeRunWorkflowThis({ hiddenOps }), 'return await callTool("createInvoice", {})');
    expect(bridged).toEqual({ id: 'inv_1' });
    expect(res.success).toBe(true);
    expect(mockExecuteSkillAction).toHaveBeenCalledWith(
      expect.objectContaining({ entry: expect.objectContaining({ skillId: 'billing' }), input: { amount: 10 } }),
    );
  });

  it('callTool bridge throws for an unknown action', async () => {
    mockExecuteImpl = async (_code, ctx) => {
      await ctx.toolHandler('ghost', {});
      return { success: true, stats: { duration: 0, toolCallCount: 0, iterationCount: 0 } };
    };
    await expect(run(makeRunWorkflowThis(), 'x')).rejects.toThrow(/unknown action "ghost"/);
  });

  it('callTool bridge throws when the action execution fails', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'createInvoice'));
    mockExecuteSkillAction.mockResolvedValue({ ok: false, status: 403, error: 'authority denied' });

    mockExecuteImpl = async (_code, ctx) => {
      await ctx.toolHandler('createInvoice', {});
      return { success: true, stats: { duration: 0, toolCallCount: 1, iterationCount: 1 } };
    };
    await expect(run(makeRunWorkflowThis({ hiddenOps }), 'x')).rejects.toThrow(/authority denied/);
  });

  it('callTool bridge defaults missing input to {}', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'createInvoice'));
    mockExecuteSkillAction.mockResolvedValue({ ok: true, status: 200, data: 1 });
    mockExecuteImpl = async (_code, ctx) => {
      // Simulate the interpreter calling with no input object.
      await ctx.toolHandler('createInvoice', undefined as unknown as Record<string, unknown>);
      return { success: true, stats: { duration: 0, toolCallCount: 1, iterationCount: 1 } };
    };
    await run(makeRunWorkflowThis({ hiddenOps }), 'x');
    expect(mockExecuteSkillAction).toHaveBeenCalledWith(expect.objectContaining({ input: {} }));
  });

  it('wires the audit writer into the action deps when one is registered', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'createInvoice'));
    mockExecuteSkillAction.mockResolvedValue({ ok: true, status: 200, data: 1 });
    const auditWriter = { writeHttpCallSuccess: jest.fn(), writeHttpCallFailure: jest.fn() };

    mockExecuteImpl = async (_code, ctx) => {
      await ctx.toolHandler('createInvoice', {});
      return { success: true, stats: { duration: 0, toolCallCount: 1, iterationCount: 1 } };
    };

    await run(makeRunWorkflowThis({ hiddenOps, auditWriter, authInfo: { user: { sub: 'alice' } } }), 'x');
    expect(mockExecuteSkillAction).toHaveBeenCalledWith(
      expect.objectContaining({ deps: expect.objectContaining({ audit: { writer: auditWriter, subject: 'alice' } }) }),
    );
  });

  it('uses "anonymous" as the audit subject when there is no authInfo', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'createInvoice'));
    mockExecuteSkillAction.mockResolvedValue({ ok: true, status: 200, data: 1 });
    const auditWriter = { writeHttpCallSuccess: jest.fn(), writeHttpCallFailure: jest.fn() };

    mockExecuteImpl = async (_code, ctx) => {
      await ctx.toolHandler('createInvoice', {});
      return { success: true, stats: { duration: 0, toolCallCount: 1, iterationCount: 1 } };
    };

    await run(makeRunWorkflowThis({ hiddenOps, auditWriter, omitAuthInfo: true }), 'x');
    expect(mockExecuteSkillAction).toHaveBeenCalledWith(
      expect.objectContaining({
        deps: expect.objectContaining({ audit: { writer: auditWriter, subject: 'anonymous' } }),
      }),
    );
  });

  it('omits audit from deps when no writer is registered', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'createInvoice'));
    mockExecuteSkillAction.mockResolvedValue({ ok: true, status: 200, data: 1 });
    mockExecuteImpl = async (_code, ctx) => {
      await ctx.toolHandler('createInvoice', {});
      return { success: true, stats: { duration: 0, toolCallCount: 1, iterationCount: 1 } };
    };
    await run(makeRunWorkflowThis({ hiddenOps }), 'x');
    const args = mockExecuteSkillAction.mock.calls[0][0] as { deps: { audit?: unknown } };
    expect(args.deps.audit).toBeUndefined();
  });
});

describe('run_workflow — enclave sandbox unavailable', () => {
  afterEach(() => {
    mockEnclaveCoreThrows = false;
    jest.resetModules();
  });

  it('returns a clear error when @enclave-vm cannot be imported', async () => {
    // Drop the cached module graph so the next import re-evaluates the mocked
    // `@enclave-vm/core/worker` factory, which now throws (peer absent).
    jest.resetModules();
    mockEnclaveCoreThrows = true;
    const { default: IsolatedTool } = await import('../tools/run-workflow.tool');
    // Re-importing gives the tool fresh DI token identities, so a key-matched
    // map would miss. The tool returns at the enclave-import catch BEFORE it
    // uses any of these singletons, so a permissive `get()` is enough — it just
    // needs an `ensureReady()` for the bundle-sync await at the top of execute().
    const ctx = {
      get: () => ({ ensureReady: async () => {} }),
      tryGet: () => undefined,
      logger: fakeLogger,
      authInfo: { user: { sub: 'u' } },
    } as unknown as RunWorkflowTool;
    const res = await IsolatedTool.prototype.execute.call(ctx, { script: 'return 1' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/@enclave-vm sandbox is not installed/);
  });
});
