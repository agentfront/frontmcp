/**
 * `codecall:invoke` enforces the same access policy as `codecall:execute` (GHSA-6w3j-82v5-6qrr).
 *
 * The advisory names this tool specifically: the `directCalls` options — `enabled`,
 * `allowedTools`, `filter` — are declared in the plugin schema and read by nothing. The tool
 * is registered unconditionally and its `execute()` checks only the self-reference guard
 * before handing the caller's tool name to `tools:call-tool`.
 *
 * That makes `codecall:invoke` a plain proxy around the whole tool registry: every restriction
 * an operator configured for CodeCall — `enabledInCodeCall`, `includeTools`, the blocked
 * namespaces, and the direct-call allowlist itself — is bypassed by naming the tool here
 * instead of inside a script.
 */
import CodeCallConfig from '../providers/code-call.config';
import InvokeTool from '../tools/invoke.tool';

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

type ToolStub = { name: string; fullName?: string; metadata?: unknown };

/** The shape `tools:call-tool` receives, so the assertions type-check against it. */
type CallToolFlowCall = [flow: string, payload: { request?: { params?: { name?: string } } }];

/** The mocked `ToolContext` surface these harnesses drive, in place of a real scope. */
interface MockedToolInstance {
  scope: { runFlow: jest.Mock; tools: { getTools: jest.Mock } };
  execute(input: Record<string, unknown>): Promise<unknown>;
  _setDependency(token: unknown, instance: unknown): void;
}

type MockedToolCtor = new () => MockedToolInstance;

function createInvokeHarness(
  options: { mode?: string; tools?: ToolStub[]; includeTools?: unknown; directCalls?: unknown } = {},
) {
  const tool = new (InvokeTool as unknown as MockedToolCtor)();

  const configValues: Record<string, unknown> = {
    mode: options.mode ?? 'codecall_only',
    includeTools: options.includeTools,
    directCalls: options.directCalls,
  };
  tool._setDependency(CodeCallConfig, {
    get: jest.fn((key: string) => configValues[key]),
    getAll: jest.fn(() => configValues),
  });

  tool.scope.runFlow = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"ok":true}' }],
    isError: false,
  });
  tool.scope.tools.getTools = jest.fn(() => options.tools ?? []);

  return {
    tool,
    runFlow: tool.scope.runFlow as jest.Mock,
    reachedFlow(name: string) {
      return (tool.scope.runFlow as jest.Mock).mock.calls.some(
        ([flow, payload]: CallToolFlowCall) => flow === 'tools:call-tool' && payload?.request?.params?.name === name,
      );
    },
  };
}

const excludedTool: ToolStub = {
  name: 'admin:deleteUser',
  fullName: 'admin:deleteUser',
  metadata: { description: 'Delete a user', codecall: { enabledInCodeCall: false } },
};

const allowedTool: ToolStub = {
  name: 'users:list',
  fullName: 'users:list',
  metadata: { description: 'List users' },
};

describe('InvokeTool — direct-call access control (GHSA-6w3j-82v5-6qrr)', () => {
  it('refuses a tool marked enabledInCodeCall: false', async () => {
    const h = createInvokeHarness({ tools: [allowedTool, excludedTool] });

    const result = await h.tool.execute({ tool: 'admin:deleteUser', input: { userId: '42' } });

    expect(h.reachedFlow('admin:deleteUser')).toBe(false);
    expect(result.isError).toBe(true);
  });

  it.each(['system:wipeConfig', 'internal:dumpState', '__proto__pollute'])(
    'refuses the default-blocked namespace %s',
    async (name) => {
      const h = createInvokeHarness({ tools: [{ name, fullName: name, metadata: {} }] });

      await h.tool.execute({ tool: name, input: {} });

      expect(h.reachedFlow(name)).toBe(false);
    },
  );

  it('refuses a tool the includeTools filter excludes', async () => {
    const h = createInvokeHarness({
      tools: [allowedTool, excludedTool],
      includeTools: (t: { name: string }) => !t.name.startsWith('admin:'),
    });

    await h.tool.execute({ tool: 'admin:deleteUser', input: { userId: '42' } });

    expect(h.reachedFlow('admin:deleteUser')).toBe(false);
  });

  it('refuses every tool when directCalls.enabled is false', async () => {
    const h = createInvokeHarness({
      tools: [allowedTool],
      directCalls: { enabled: false },
    });

    const result = await h.tool.execute({ tool: 'users:list', input: {} });

    expect(h.reachedFlow('users:list')).toBe(false);
    expect(result.isError).toBe(true);
  });

  it('refuses a tool absent from directCalls.allowedTools', async () => {
    const h = createInvokeHarness({
      tools: [allowedTool, { name: 'users:delete', fullName: 'users:delete', metadata: {} }],
      directCalls: { enabled: true, allowedTools: ['users:list'] },
    });

    await h.tool.execute({ tool: 'users:delete', input: {} });

    expect(h.reachedFlow('users:delete')).toBe(false);
  });

  it('refuses a tool rejected by directCalls.filter', async () => {
    const h = createInvokeHarness({
      tools: [allowedTool, excludedTool],
      directCalls: { enabled: true, filter: (t: { name: string }) => t.name !== 'users:list' },
    });

    await h.tool.execute({ tool: 'users:list', input: {} });

    expect(h.reachedFlow('users:list')).toBe(false);
  });

  it('still invokes a permitted tool — the gate must not break ordinary use', async () => {
    const h = createInvokeHarness({
      tools: [allowedTool, excludedTool],
      directCalls: { enabled: true, allowedTools: ['users:list'] },
    });

    await h.tool.execute({ tool: 'users:list', input: {} });

    expect(h.reachedFlow('users:list')).toBe(true);
  });

  it('still invokes a permitted tool when directCalls is left unconfigured', async () => {
    const h = createInvokeHarness({ tools: [allowedTool] });

    await h.tool.execute({ tool: 'users:list', input: {} });

    expect(h.reachedFlow('users:list')).toBe(true);
  });
});
