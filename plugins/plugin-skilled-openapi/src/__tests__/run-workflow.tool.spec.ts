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
import { ScopeEntry, type CallToolResult } from '@frontmcp/sdk';

import { HiddenOpRegistry, type HiddenOpEntry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import type { SkillFilterScope, VisibleListings } from '../security/skill-visibility';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';
import { BundleSyncService } from '../sync/bundle-sync.service';
import { runWorkflowDescription, type RunWorkflowOutput } from '../tools/run-workflow.schema';
import RunWorkflowTool from '../tools/run-workflow.tool';
import { scopeHidingSkills } from './skill-filter-scope.fixture';

// ── Controllable mocks (factories may only reference `mock`-prefixed vars) ──

type FakeStats = { duration: number; toolCallCount: number; iterationCount: number };
type FakeResult = { success: boolean; value?: unknown; error?: { message: string }; stats: FakeStats };
type FakeCtx = { toolHandler: (actionId: string, input: Record<string, unknown>) => Promise<unknown> };
type TransformConfig = { transformLoops?: boolean; additionalIdentifiers?: string[] };

let mockTransformImpl: (code: string, cfg?: TransformConfig) => string;
let mockExecuteImpl: (code: string, ctx: FakeCtx) => Promise<FakeResult>;
// When set, the mocked `@enclave-vm/core/worker` module throws on (re)load,
// simulating the optional sandbox peer being absent. Re-evaluated only after
// resetModules. We gate the throw on core/worker (NOT ast) because @frontmcp/utils
// imports @enclave-vm/ast at module load, so a throwing ast mock would break the
// whole import chain instead of just the tool's lazy sandbox import.
let mockEnclaveCoreThrows = false;

jest.mock('@enclave-vm/ast', () => ({
  transformAgentScript: (code: string, cfg?: TransformConfig) => mockTransformImpl(code, cfg),
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
    signal?: AbortSignal;
    scope?: SkillFilterScope;
  } = {},
) {
  const resolver = { resolve: jest.fn(async () => ({ token: 'sk_x' })) };
  const map = new Map<unknown, unknown>();
  // run_workflow `await`s ensureLoaded() before resolving actions; the hidden-op
  // registry here is pre-seeded, so the sync is a no-op in this unit test.
  map.set(BundleSyncService, { ensureLoaded: async () => {} });
  map.set(SkilledOpenApiConfig, args.config ?? baseConfig());
  map.set(HiddenOpRegistry, args.hiddenOps ?? new HiddenOpRegistry());
  map.set(AuthorityGuard, new AuthorityGuard());
  map.set(ScopeEntry, args.scope ?? scopeHidingSkills().scope);
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
    signal: args.signal,
  } as unknown as RunWorkflowTool;
}

const run = (ctx: RunWorkflowTool, script: string) => RunWorkflowTool.prototype.execute.call(ctx, { script });

/** A failed run comes back as an error result; its structured content is the workflow's output. */
function isErrorResult(result: RunWorkflowOutput | CallToolResult): result is CallToolResult {
  return 'isError' in result && result.isError === true;
}

/** The workflow's output, whether the run succeeded or came back as an error result. */
async function runOutput(ctx: RunWorkflowTool, script: string): Promise<RunWorkflowOutput> {
  const result = await run(ctx, script);
  return isErrorResult(result) ? (result.structuredContent as RunWorkflowOutput) : result;
}

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

/** The longest tool description a server lists without a manifest lint finding (`instructionsBudget.toolDescription`). */
const TOOL_DESCRIPTION_BUDGET = 1024;

describe('run_workflow', () => {
  it('has a description within the tool-description budget, naming throwOnError and the error body', () => {
    expect(runWorkflowDescription.length).toBeLessThanOrEqual(TOOL_DESCRIPTION_BUDGET);
    expect(runWorkflowDescription).toContain('{ throwOnError: false }');
    expect(runWorkflowDescription).toContain('failed with status 404: {"error":"not found"}');
  });

  it('returns success + mapped stats for a completed workflow', async () => {
    const ctx = makeRunWorkflowThis();
    const res = await run(ctx, 'return 1');
    expect(res).toEqual({
      success: true,
      value: 'done',
      stats: { durationMs: 5, toolCalls: 0, steps: 3 },
    });
  });

  it('passes transformLoops:false to the AgentScript transform, and leaves callTool to the prelude', async () => {
    const seen: Array<TransformConfig | undefined> = [];
    mockTransformImpl = (code, cfg) => {
      seen.push(cfg);
      return code;
    };
    await run(makeRunWorkflowThis(), 'return 1');
    expect(seen[0]).toEqual({ transformLoops: false, additionalIdentifiers: ['callTool'] });
  });

  it('runs the program after a callTool that takes options', async () => {
    let interpreted = '';
    mockTransformImpl = () => 'async function __ag_main() { return 1; }';
    mockExecuteImpl = async (code) => {
      interpreted = code;
      return { success: true, value: 1, stats: { duration: 0, toolCallCount: 0, iterationCount: 1 } };
    };
    await run(makeRunWorkflowThis(), 'return 1');
    expect(interpreted).toMatch(/^async function callTool\(actionId, input, options\) \{/);
    expect(interpreted.endsWith('\nasync function __ag_main() { return 1; }')).toBe(true);
  });

  it('returns failure when AgentScript is rejected (Error)', async () => {
    mockTransformImpl = () => {
      throw new Error('forbidden token');
    };
    const res = await runOutput(makeRunWorkflowThis(), 'eval("x")');
    expect(res.success).toBe(false);
    expect(res.error).toBe('AgentScript rejected: forbidden token');
  });

  it('returns failure when AgentScript transform throws a non-Error', async () => {
    mockTransformImpl = () => {
      throw 'plain string blow-up';
    };
    const res = await runOutput(makeRunWorkflowThis(), 'bad');
    expect(res.success).toBe(false);
    expect(res.error).toBe('AgentScript rejected: plain string blow-up');
  });

  it('reports a failed workflow run as an error result, with its error message + stats as structured content', async () => {
    mockExecuteImpl = async () => ({
      success: false,
      error: { message: 'boom at step 4' },
      stats: { duration: 7, toolCallCount: 1, iterationCount: 9 },
    });
    const res = await run(makeRunWorkflowThis(), 'return 1');
    const output = { success: false, error: 'boom at step 4', stats: { durationMs: 7, toolCalls: 1, steps: 9 } };
    expect(res).toEqual({
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output,
      isError: true,
    });
  });

  it('answers a completed workflow without isError', async () => {
    const res = await run(makeRunWorkflowThis(), 'return 1');
    expect(res).not.toHaveProperty('isError');
  });

  it('falls back to a generic message when a failed run has no error', async () => {
    mockExecuteImpl = async () => ({
      success: false,
      stats: { duration: 0, toolCallCount: 0, iterationCount: 0 },
    });
    const res = await runOutput(makeRunWorkflowThis(), 'return 1');
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

    const res = await runOutput(makeRunWorkflowThis({ hiddenOps }), 'return await callTool("createInvoice", {})');
    expect(bridged).toEqual({ id: 'inv_1' });
    expect(res.success).toBe(true);
    expect(mockExecuteSkillAction).toHaveBeenCalledWith(
      expect.objectContaining({ listings: [expect.objectContaining({ skillId: 'billing' })], input: { amount: 10 } }),
    );
  });

  it('callTool bridge resolves the actions of the bundle the workflow started on, when a swap lands while it runs', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('reports', 'getAccountPlan'));
    mockExecuteSkillAction.mockResolvedValue({ ok: true, status: 200, data: { plan: 'growth' } });

    let bridged: unknown;
    mockExecuteImpl = async (_code, ctx) => {
      hiddenOps.clear();
      hiddenOps.set(buildEntry('refunds', 'refundInvoice'));
      bridged = await ctx.toolHandler('getAccountPlan', {});
      return { success: true, value: bridged, stats: { duration: 1, toolCallCount: 1, iterationCount: 1 } };
    };

    const res = await runOutput(makeRunWorkflowThis({ hiddenOps }), 'return await callTool("getAccountPlan", {})');
    expect(res).toMatchObject({ success: true, value: { plan: 'growth' } });
    expect(mockExecuteSkillAction).toHaveBeenCalledWith(
      expect.objectContaining({ listings: [expect.objectContaining({ skillId: 'reports' })] }),
    );
  });

  it("judges the actions' listings once, as the workflow starts, by the skills:filter flow", async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('flagged', 'getAccountPlan'));
    hiddenOps.set(buildEntry('reports', 'getAccountPlan'));
    const { scope, filterRuns } = scopeHidingSkills('flagged');
    mockExecuteSkillAction.mockResolvedValue({ ok: true, status: 200, data: { plan: 'growth' } });
    mockExecuteImpl = async (_code, ctx) => {
      await ctx.toolHandler('getAccountPlan', {});
      await ctx.toolHandler('getAccountPlan', {});
      return { success: true, stats: { duration: 1, toolCallCount: 2, iterationCount: 1 } };
    };

    await run(makeRunWorkflowThis({ hiddenOps, scope }), 'return await callTool("getAccountPlan", {})');

    const [{ listings, deps }] = mockExecuteSkillAction.mock.calls[0] as [
      { listings: HiddenOpEntry[]; deps: { visibleListings: VisibleListings } },
    ];
    expect(await deps.visibleListings(listings)).toEqual([expect.objectContaining({ skillId: 'reports' })]);
    expect(filterRuns).toHaveBeenCalledTimes(1);
  });

  it('fails the workflow, without running it, when the skills:filter flow rejects', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('reports', 'getAccountPlan'));
    const { scope, filterRuns } = scopeHidingSkills();
    filterRuns.mockRejectedValueOnce(new Error('flag service down'));
    mockExecuteImpl = jest.fn();

    const res = await runOutput(
      makeRunWorkflowThis({ hiddenOps, scope }),
      'return await callTool("getAccountPlan", {})',
    );

    expect(res).toMatchObject({ success: false, error: 'the skills:filter flow failed, so the workflow did not run' });
    expect(JSON.stringify(res)).not.toContain('flag service down');
    expect(mockExecuteImpl).not.toHaveBeenCalled();
    expect(mockExecuteSkillAction).not.toHaveBeenCalled();
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

describe('run_workflow — what a failed action call gives the script', () => {
  const stats = { duration: 1, toolCallCount: 1, iterationCount: 1 };
  const refundTooLarge = {
    error: 'refund_too_large',
    message: 'Refund 500 exceeds the paid amount 120.',
    maxRefund: 120,
  };
  const QUIET = { __callToolOptions: { throwOnError: false } };

  const workflowWithRefunds = (config?: SkilledOpenApiConfig) => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'refundInvoice'));
    return makeRunWorkflowThis({ hiddenOps, config });
  };

  /** What the script's one call to `actionId` resolved to, or the message it threw. */
  async function callFromScript(
    ctx: RunWorkflowTool,
    actionId: string,
    input: Record<string, unknown>,
  ): Promise<{ value?: unknown; thrown?: string }> {
    let outcome: { value?: unknown; thrown?: string } = {};
    mockExecuteImpl = async (_code, fakeCtx) => {
      outcome = await fakeCtx.toolHandler(actionId, input).then(
        (value) => ({ value }),
        (error: Error) => ({ thrown: error.message }),
      );
      return { success: true, stats };
    };
    await run(ctx, 'x');
    return outcome;
  }

  it("throws an HTTP failure with the API's error body", async () => {
    mockExecuteSkillAction.mockResolvedValue({ ok: false, status: 422, data: refundTooLarge });

    const outcome = await callFromScript(workflowWithRefunds(), 'refundInvoice', { amount: 500 });

    expect(outcome.thrown).toBe(`action "refundInvoice" failed with status 422: ${JSON.stringify(refundTooLarge)}`);
  });

  it("throws an HTTP failure with its status alone under errorBodies 'status-only'", async () => {
    mockExecuteSkillAction.mockResolvedValue({ ok: false, status: 422, data: refundTooLarge });
    const config = baseConfig({
      outbound: {
        allowPrivateNetworks: true,
        maxConcurrencyPerHost: 10,
        defaultTimeoutMs: 5_000,
        defaultMaxResponseBytes: 256 * 1024,
        allowHttp: true,
        errorBodies: 'status-only',
      },
    });

    const outcome = await callFromScript(workflowWithRefunds(config), 'refundInvoice', { amount: 500 });

    expect(outcome.thrown).toBe('action "refundInvoice" failed with status 422');
  });

  it('with throwOnError false, returns ok, the status and the data of a success', async () => {
    mockExecuteSkillAction.mockResolvedValue({ ok: true, status: 201, data: { refundId: 'rfnd_1' } });

    const outcome = await callFromScript(workflowWithRefunds(), 'refundInvoice', { amount: 50, ...QUIET });

    expect(outcome.value).toEqual({ ok: true, status: 201, data: { refundId: 'rfnd_1' } });
    expect(mockExecuteSkillAction).toHaveBeenCalledWith(expect.objectContaining({ input: { amount: 50 } }));
  });

  it("with throwOnError false, returns an HTTP failure's status and the API's error body as data", async () => {
    mockExecuteSkillAction.mockResolvedValue({ ok: false, status: 422, data: refundTooLarge });

    const outcome = await callFromScript(workflowWithRefunds(), 'refundInvoice', { amount: 500, ...QUIET });

    expect(outcome.value).toEqual({ ok: false, status: 422, data: refundTooLarge });
  });

  it('with throwOnError false, returns status 0 and the reason of a failure with no answer', async () => {
    mockExecuteSkillAction.mockResolvedValue({ ok: false, status: 0, error: 'input validation failed: id: Required' });

    const outcome = await callFromScript(workflowWithRefunds(), 'refundInvoice', QUIET);

    expect(outcome.value).toEqual({ ok: false, status: 0, error: 'input validation failed: id: Required' });
  });

  it('with throwOnError false, returns status 0 for an unknown action', async () => {
    const outcome = await callFromScript(workflowWithRefunds(), 'ghost', QUIET);

    expect(outcome.value).toEqual({
      ok: false,
      status: 0,
      error: expect.stringMatching(/^unknown action "ghost"/),
    });
  });

  it('throws with any other options', async () => {
    mockExecuteSkillAction.mockResolvedValue({ ok: false, status: 404, data: { error: 'invoice not found' } });

    const outcome = await callFromScript(workflowWithRefunds(), 'refundInvoice', {
      __callToolOptions: { throwOnError: true },
    });

    expect(outcome.thrown).toBe('action "refundInvoice" failed with status 404: {"error":"invoice not found"}');
  });
});

describe('run_workflow — the requests of a workflow that has ended', () => {
  const stats = { duration: 1, toolCallCount: 1, iterationCount: 1 };
  const WORKFLOW_ENDED = 'request aborted: the workflow ended before the request finished';

  const workflowWithInvoices = (signal?: AbortSignal) => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'createInvoice'));
    return makeRunWorkflowThis({ hiddenOps, signal });
  };

  /** Each call answers only when its signal fires, with the failure the outbound call reports for it. */
  const callsWaitForTheirSignal = () =>
    mockExecuteSkillAction.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () =>
            resolve({ ok: false, status: 0, error: `request aborted: ${(signal.reason as Error).message}` }),
          );
        }),
    );

  const signalOfCall = (index: number): AbortSignal => mockExecuteSkillAction.mock.calls[index][0].signal;

  it('aborts a call still in flight when the workflow times out, and still reports the timeout', async () => {
    callsWaitForTheirSignal();
    let inFlight: Promise<unknown> = Promise.resolve();
    mockExecuteImpl = async (_code, ctx) => {
      inFlight = ctx.toolHandler('createInvoice', {}).catch((error: Error) => error.message);
      return { success: false, error: { message: 'Execution timed out after 8000ms' }, stats };
    };

    const res = await runOutput(workflowWithInvoices(), 'return await callTool("createInvoice", {})');

    expect(res).toMatchObject({ success: false, error: 'Execution timed out after 8000ms' });
    await expect(inFlight).resolves.toBe(WORKFLOW_ENDED);
  });

  it.each([
    ['returns', { success: true, value: 1, stats }],
    ['fails', { success: false, error: { message: 'Tool call limit exceeded (25)' }, stats }],
  ])('aborts the signal its calls run with once the workflow %s', async (_end, outcome) => {
    mockExecuteSkillAction.mockResolvedValue({ ok: true, status: 200, data: 1 });
    let abortedDuringCall: boolean | undefined;
    mockExecuteImpl = async (_code, ctx) => {
      await ctx.toolHandler('createInvoice', {});
      abortedDuringCall = signalOfCall(0).aborted;
      return outcome;
    };

    await run(workflowWithInvoices(), 'return await callTool("createInvoice", {})');

    expect(abortedDuringCall).toBe(false);
    expect(signalOfCall(0).aborted).toBe(true);
  });

  it('hands a call made after the workflow ended a signal that has already fired', async () => {
    let abortedWhenCalled: boolean | undefined;
    mockExecuteSkillAction.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
      abortedWhenCalled = signal.aborted;
      return { ok: true, status: 200, data: 1 };
    });
    let lateCall: () => Promise<unknown> = async () => undefined;
    mockExecuteImpl = async (_code, ctx) => {
      lateCall = () => ctx.toolHandler('createInvoice', {});
      return { success: true, value: 1, stats };
    };

    await run(workflowWithInvoices(), 'return 1');
    await lateCall();

    expect(abortedWhenCalled).toBe(true);
  });

  it('aborts its calls when the run_workflow call itself is cancelled', async () => {
    callsWaitForTheirSignal();
    const request = new AbortController();
    let callError: unknown;
    mockExecuteImpl = async (_code, ctx) => {
      const inFlight = ctx.toolHandler('createInvoice', {}).catch((error: Error) => error.message);
      request.abort(new Error('the client cancelled the call'));
      callError = await inFlight;
      return { success: false, error: { message: String(callError) }, stats };
    };

    await run(workflowWithInvoices(request.signal), 'x');

    expect(callError).toBe('request aborted: the client cancelled the call');
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
    const { default: IsolatedTool } = (await import('../tools/run-workflow.tool.js')) as unknown as {
      default: typeof RunWorkflowTool;
    };
    // Re-importing gives the tool fresh DI token identities, so a key-matched
    // map would miss. The tool returns at the enclave-import catch BEFORE it
    // uses any of these singletons, so a permissive `get()` is enough — it just
    // needs an `ensureLoaded()` for the bundle-sync await at the top of execute().
    const ctx = {
      get: () => ({ ensureLoaded: async () => {} }),
      tryGet: () => undefined,
      logger: fakeLogger,
      authInfo: { user: { sub: 'u' } },
    } as unknown as RunWorkflowTool;
    const res = await IsolatedTool.prototype.execute.call(ctx, { script: 'return 1' });
    expect(res).toMatchObject({
      isError: true,
      structuredContent: { success: false, error: expect.stringMatching(/@enclave-vm sandbox is not installed/) },
    });
  });
});
