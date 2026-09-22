/**
 * The audit trail has to be reachable from the code that runs.
 *
 * `AuditLoggerService` was implemented, unit-tested to ~40 assertions, and registered by nothing:
 * `CodeCallPlugin` declared `providers: []` and no tool ever resolved it. Meanwhile
 * `production.mdx` told operators CodeCall "emits structured log events for observability" and
 * listed four of them. Nothing was emitted, and none of the four names even matched the ones the
 * service defines.
 *
 * `audit-logger.service.spec.ts` covers the service in isolation and passed throughout. That is
 * exactly the gap these tests close: they drive the real execution path and assert events come out
 * the other end.
 */
import CodeCallConfig from '../providers/code-call.config';
import { AUDIT_EVENT_TYPES, AuditLoggerService, type AuditEvent } from '../services/audit-logger.service';
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

interface MockedToolInstance {
  scope: { runFlow: jest.Mock; tools: { getTools: jest.Mock } };
  execute(input: Record<string, unknown>): Promise<unknown>;
  _setDependency(token: unknown, instance: unknown): void;
}

type CapturedEnv = {
  callTool: (name: string, input: unknown, opts?: unknown) => Promise<unknown>;
  getTool: (name: string) => unknown;
};

/** An ExecuteTool with a real AuditLoggerService attached and every event captured. */
function createHarness(options: { tools?: ToolStub[]; registerAudit?: boolean } = {}) {
  const tool = new (ExecuteTool as unknown as new () => MockedToolInstance)();

  let capturedEnv: CapturedEnv | undefined;
  const mockEnclave = {
    execute: jest.fn(async (_script: string, env: unknown) => {
      capturedEnv = env as CapturedEnv;
      return { success: true, result: null, logs: [], timedOut: false, stats: { duration: 7 } };
    }),
  };

  const configValues: Record<string, unknown> = {
    'resolvedVm.timeoutMs': 5000,
    'resolvedVm.allowConsole': false,
    mode: 'codecall_only',
  };

  tool._setDependency(EnclaveService, mockEnclave);
  tool._setDependency(CodeCallConfig, {
    get: jest.fn((key: string) => configValues[key]),
    getAll: jest.fn(() => configValues),
  });

  const events: AuditEvent[] = [];
  if (options.registerAudit !== false) {
    const audit = new AuditLoggerService();
    audit.subscribe((event) => events.push(event));
    tool._setDependency(AuditLoggerService, audit);
  }

  tool.scope.runFlow = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"ok":true}' }],
    isError: false,
  });
  tool.scope.tools.getTools = jest.fn(() => options.tools ?? []);

  return {
    events,
    types: () => events.map((event) => event.type),
    mockEnclave,
    async run(script = 'noop') {
      await tool.execute({ script });
      if (!capturedEnv) throw new Error('enclave never received an environment');
      return capturedEnv;
    },
  };
}

const allowedTool: ToolStub = { name: 'users:list', fullName: 'users:list', metadata: {} };
const excludedTool: ToolStub = {
  name: 'admin:deleteUser',
  fullName: 'admin:deleteUser',
  metadata: { codecall: { enabledInCodeCall: false } },
};
const blockedNamespaceTool: ToolStub = {
  name: 'system:wipeConfig',
  fullName: 'system:wipeConfig',
  metadata: {},
};

describe('CodeCall audit events reach the execution path', () => {
  it('a script run emits the execution lifecycle', async () => {
    const harness = createHarness();
    await harness.run();

    expect(harness.types()).toEqual([AUDIT_EVENT_TYPES.EXECUTION_START, AUDIT_EVENT_TYPES.EXECUTION_SUCCESS]);
  });

  it('correlates every event of one run under a single executionId', async () => {
    const harness = createHarness({ tools: [allowedTool] });
    const env = await harness.run();
    await env.callTool('users:list', {}, { throwOnError: false });

    const ids = new Set(harness.events.map((event) => event.executionId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^exec_/);
  });

  it('a permitted tool call emits start then success, and is counted', async () => {
    const harness = createHarness({ tools: [allowedTool] });
    const env = await harness.run();
    await env.callTool('users:list', {}, { throwOnError: false });

    expect(harness.types()).toContain(AUDIT_EVENT_TYPES.TOOL_CALL_START);
    expect(harness.types()).toContain(AUDIT_EVENT_TYPES.TOOL_CALL_SUCCESS);

    const success = harness.events.find((event) => event.type === AUDIT_EVENT_TYPES.TOOL_CALL_SUCCESS);
    expect(success?.data).toMatchObject({ toolName: 'users:list', callDepth: 1 });
    expect(typeof success?.durationMs).toBe('number');
  });

  it('a tool the policy denies emits access-denied with the real reason', async () => {
    const harness = createHarness({ tools: [excludedTool] });
    const env = await harness.run();
    await env.callTool('admin:deleteUser', {}, { throwOnError: false });

    const denied = harness.events.find((event) => event.type === AUDIT_EVENT_TYPES.SECURITY_ACCESS_DENIED);
    expect(denied?.data).toMatchObject({ blocked: 'admin:deleteUser' });
    expect(String(denied?.data?.['reason'])).toContain('enabledInCodeCall');
    expect(harness.types()).not.toContain(AUDIT_EVENT_TYPES.TOOL_CALL_START);
  });

  it('a blocked namespace emits access-denied', async () => {
    const harness = createHarness({ tools: [blockedNamespaceTool] });
    const env = await harness.run();
    await env.callTool('system:wipeConfig', {}, { throwOnError: false });

    const denied = harness.events.find((event) => event.type === AUDIT_EVENT_TYPES.SECURITY_ACCESS_DENIED);
    expect(String(denied?.data?.['reason'])).toContain('namespace CodeCall never calls');
  });

  it('a self-reference attempt is audited', async () => {
    const harness = createHarness();
    const env = await harness.run();
    await env.callTool('codecall:execute', {}, { throwOnError: false }).catch(() => undefined);

    expect(harness.types()).toContain(AUDIT_EVENT_TYPES.SECURITY_SELF_REFERENCE);
  });

  it('getTool introspection denials are audited, so enumeration is visible', async () => {
    const harness = createHarness({ tools: [excludedTool] });
    const env = await harness.run();
    env.getTool('admin:deleteUser');

    const denied = harness.events.find((event) => event.type === AUDIT_EVENT_TYPES.SECURITY_ACCESS_DENIED);
    expect(denied?.data).toMatchObject({ blocked: 'admin:deleteUser' });
  });

  it('never records script source or tool arguments', async () => {
    const secret = 'const apiKey = "sk-live-never-log-me";';
    const harness = createHarness({ tools: [allowedTool] });
    const env = await harness.run(secret);
    await env.callTool('users:list', { ssn: '000-00-0000' }, { throwOnError: false });

    const serialized = JSON.stringify(harness.events);
    expect(serialized).not.toContain('sk-live-never-log-me');
    expect(serialized).not.toContain('000-00-0000');

    const start = harness.events.find((event) => event.type === AUDIT_EVENT_TYPES.EXECUTION_START);
    expect(start?.data).toMatchObject({ scriptLength: secret.length });
  });

  it('execution is unaffected when the service is not registered', async () => {
    const harness = createHarness({ tools: [allowedTool], registerAudit: false });
    const env = await harness.run();

    await expect(env.callTool('users:list', {}, { throwOnError: false })).resolves.toEqual({
      success: true,
      data: { ok: true },
    });
    expect(harness.events).toHaveLength(0);
  });
});
