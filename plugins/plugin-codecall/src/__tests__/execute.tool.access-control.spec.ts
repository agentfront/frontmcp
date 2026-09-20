/**
 * CodeCall enforces its tool-access policy at EXECUTION time (GHSA-6w3j-82v5-6qrr).
 *
 * The documented controls — per-tool `codecall.enabledInCodeCall`, the `includeTools`
 * filter, and the default blocked namespaces (`system:*`, `internal:*`, `__*`) — were
 * applied only while building the search index. `callTool()` checked nothing but the
 * self-reference guard and an `allowedTools` list read from the CALLER'S OWN input, so a
 * script could name an excluded tool directly and it ran through `tools:call-tool` with
 * the caller's auth.
 *
 * Hiding a tool from discovery is not authorization. These tests assert at the choke
 * point that matters: an excluded tool must never reach the flow.
 */
import CodeCallConfig from '../providers/code-call.config';
import EnclaveService from '../services/enclave.service';
import ExecuteTool from '../tools/execute.tool';

jest.mock('@frontmcp/sdk', () => ({
  Tool:
    (_config: unknown) =>
    <T>(target: T) =>
      target,
  Provider:
    (_config: unknown) =>
    <T>(target: T) =>
      target,
  ProviderScope: { GLOBAL: 'global', REQUEST: 'request' },
  BaseConfig: class MockBaseConfig {
    protected options: Record<string, unknown>;
    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
    }
    get(key: string): unknown {
      return this.options[key];
    }
  },
  ToolContext: class MockToolContext {
    private dependencies = new Map<unknown, unknown>();
    scope = {
      tools: { getTools: jest.fn(() => []) },
      runFlow: jest.fn(() => Promise.resolve(null)),
    };
    authInfo = undefined;
    logger = undefined;
    constructor(_args?: unknown) {}
    get<T>(token: unknown): T {
      if (!this.dependencies.has(token)) {
        throw new Error(`Dependency not found: ${(token as { name?: string })?.name || token}`);
      }
      return this.dependencies.get(token) as T;
    }
    tryGet<T>(token: unknown): T | undefined {
      return this.dependencies.get(token) as T | undefined;
    }
    _setDependency(token: unknown, instance: unknown): void {
      this.dependencies.set(token, instance);
    }
  },
}));

jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  extractResultFromCallToolResult: jest.fn(() => ({ ok: true })),
}));

type ToolStub = { name: string; fullName?: string; metadata?: unknown };

/** The shape `tools:call-tool` receives, so the assertions type-check against it. */
type CallToolFlowCall = [flow: string, payload: { request?: { params?: { name?: string } } }];

/**
 * Build an ExecuteTool whose enclave hands the `callTool` environment straight back, so a
 * test can drive the exact function an AgentScript would call.
 */
function createToolHarness(options: { mode?: string; tools?: ToolStub[]; includeTools?: unknown } = {}) {
  const tool = new (ExecuteTool as any)();

  let capturedEnv: { callTool: (name: string, input: unknown, opts?: unknown) => Promise<unknown> } | undefined;
  const mockEnclave = {
    execute: jest.fn(async (_script: string, env: unknown) => {
      capturedEnv = env as typeof capturedEnv;
      return { success: true, result: null, logs: [], timedOut: false, stats: { duration: 1 } };
    }),
  };

  const configValues: Record<string, unknown> = {
    'resolvedVm.timeoutMs': 5000,
    'resolvedVm.allowConsole': false,
    mode: options.mode ?? 'codecall_only',
    includeTools: options.includeTools,
  };
  const mockConfig = {
    get: jest.fn((key: string) => configValues[key]),
    getAll: jest.fn(() => configValues),
  };

  tool._setDependency(EnclaveService, mockEnclave);
  tool._setDependency(CodeCallConfig, mockConfig);
  tool.scope.runFlow = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"ok":true}' }],
    isError: false,
  });
  tool.scope.tools.getTools = jest.fn(() => options.tools ?? []);

  return {
    tool,
    runFlow: tool.scope.runFlow as jest.Mock,
    async callTool(name: string, input: unknown = {}, allowedTools?: string[]) {
      // The environment is rebuilt on each execute, so the allowlist under test has to be
      // passed to the SAME execute whose environment we then drive.
      await tool.execute(allowedTools ? { script: 'noop', allowedTools } : { script: 'noop' });
      if (!capturedEnv) throw new Error('enclave never received a callTool environment');
      return capturedEnv.callTool(name, input, { throwOnError: false });
    },
  };
}

/** A tool the operator has explicitly opted out of CodeCall. */
const excludedTool: ToolStub = {
  name: 'admin:deleteUser',
  fullName: 'admin:deleteUser',
  metadata: { description: 'Delete a user', codecall: { enabledInCodeCall: false } },
};

/** An ordinary tool that must keep working. */
const allowedTool: ToolStub = {
  name: 'users:list',
  fullName: 'users:list',
  metadata: { description: 'List users' },
};

describe('ExecuteTool — execution-time tool access control (GHSA-6w3j-82v5-6qrr)', () => {
  it('refuses a tool marked enabledInCodeCall: false', async () => {
    const h = createToolHarness({ tools: [allowedTool, excludedTool] });

    await h.callTool('admin:deleteUser', { userId: '42' });

    // The only assertion that matters: the excluded tool must never reach the flow.
    const reached = h.runFlow.mock.calls.some(
      ([flow, payload]: CallToolFlowCall) =>
        flow === 'tools:call-tool' && payload?.request?.params?.name === 'admin:deleteUser',
    );
    expect(reached).toBe(false);
  });

  it.each(['system:wipeConfig', 'internal:dumpState', '__proto__pollute'])(
    'refuses the default-blocked namespace %s',
    async (name) => {
      const h = createToolHarness({ tools: [{ name, fullName: name, metadata: {} }] });

      await h.callTool(name, {});

      const reached = h.runFlow.mock.calls.some(
        ([flow, payload]: CallToolFlowCall) => flow === 'tools:call-tool' && payload?.request?.params?.name === name,
      );
      expect(reached).toBe(false);
    },
  );

  it('refuses a tool the includeTools filter excludes', async () => {
    const h = createToolHarness({
      tools: [allowedTool, excludedTool],
      includeTools: (t: { name: string }) => !t.name.startsWith('admin:'),
    });

    await h.callTool('admin:deleteUser', { userId: '42' });

    const reached = h.runFlow.mock.calls.some(
      ([flow, payload]: CallToolFlowCall) =>
        flow === 'tools:call-tool' && payload?.request?.params?.name === 'admin:deleteUser',
    );
    expect(reached).toBe(false);
  });

  it('still runs a permitted tool — the gate must not break ordinary use', async () => {
    const h = createToolHarness({ tools: [allowedTool, excludedTool] });

    await h.callTool('users:list', {});

    const reached = h.runFlow.mock.calls.some(
      ([flow, payload]: CallToolFlowCall) =>
        flow === 'tools:call-tool' && payload?.request?.params?.name === 'users:list',
    );
    expect(reached).toBe(true);
  });

  it('still narrows: a permitted tool absent from allowedTools is refused', async () => {
    const h = createToolHarness({ tools: [allowedTool, excludedTool] });

    await h.callTool('users:list', {}, ['something:else']);

    const reached = h.runFlow.mock.calls.some(
      ([flow, payload]: CallToolFlowCall) =>
        flow === 'tools:call-tool' && payload?.request?.params?.name === 'users:list',
    );
    expect(reached).toBe(false);
  });

  it('refuses a blocked namespace reached through a bare alias', async () => {
    // The entry answers to both spellings and the flow dispatches fullName, so judging only
    // the bare `name` would let `system:*` through.
    const h = createToolHarness({
      tools: [{ name: 'wipeConfig', fullName: 'system:wipeConfig', metadata: {} }],
    });

    await h.callTool('wipeConfig', {});

    const reached = h.runFlow.mock.calls.some(([flow]: CallToolFlowCall) => flow === 'tools:call-tool');
    expect(reached).toBe(false);
  });

  it('treats a caller-supplied allowedTools as narrowing only, never widening', async () => {
    const h = createToolHarness({ tools: [allowedTool, excludedTool] });

    // The caller names the excluded tool in its own allowlist. A self-declared
    // allowlist must not be able to grant access the server policy withholds.
    await h.callTool('admin:deleteUser', { userId: '42' }, ['admin:deleteUser']);

    const reached = h.runFlow.mock.calls.some(
      ([flow, payload]: CallToolFlowCall) =>
        flow === 'tools:call-tool' && payload?.request?.params?.name === 'admin:deleteUser',
    );
    expect(reached).toBe(false);
  });
});
