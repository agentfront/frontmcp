// file: plugins/plugin-codecall/src/__tests__/enclave.service.runtime.spec.ts
//
// EnclaveService on top of the runtime seam: which runtime a configuration selects, how a refusal
// is reported, what the service hands a runtime, and that nothing of a script reaches the host once
// its run has returned.

import type { ToolHandler } from '@enclave-vm/core/worker';

import type { CodeCallVmEnvironment } from '../codecall.symbol';
import type { CodeCallPluginOptions } from '../codecall.types';
import CodeCallConfig from '../providers/code-call.config';
import EnclaveService, { ScriptTooLargeError } from '../services/enclave.service';
import {
  createDefaultRuntimes,
  type CodeCallRunResult,
  type CodeCallScriptRunner,
  type CodeCallScriptRunSpec,
  type CodeCallScriptRuntime,
  type CodeCallScriptRuntimes,
} from '../services/runtime';
import { ExecutionEndedError } from '../services/runtime/execution-gate';
import { createInterpreterRuntime } from '../services/runtime/interpreter.runtime';

/** Calls a tool handler as the sandbox does: Enclave 2.21 adds the call's position, which 2.20 ignores. */
function callToolHandler(handler: ToolHandler, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const params = [toolName, args, { callIndex: 0 }] as unknown as Parameters<ToolHandler>;
  return handler(...params);
}

/**
 * A configuration whose resolved `vm` options carry the runtime fields, as the configuration
 * schema resolves them (`vm.runtime` and its budgets).
 */
function configWith(
  runtimeFields: Record<string, unknown>,
  options: Partial<CodeCallPluginOptions> = { vm: { preset: 'secure', timeoutMs: 5000 } },
): CodeCallConfig {
  const config = new CodeCallConfig(options);
  const all = config.getAll();
  const resolvedVm = { ...all.resolvedVm, ...runtimeFields };
  return { getAll: () => ({ ...all, resolvedVm }) } as unknown as CodeCallConfig;
}

function environment(overrides: Partial<CodeCallVmEnvironment> = {}): CodeCallVmEnvironment {
  return {
    callTool: jest.fn().mockResolvedValue({ ok: true }),
    getTool: jest.fn().mockReturnValue({ name: 'a', inputSchema: null, outputSchema: null }),
    mcpLog: jest.fn(),
    mcpNotify: jest.fn(),
    ...overrides,
  };
}

function okResult(value: unknown, toolCallCount = 0): CodeCallRunResult {
  return { success: true, value, stats: { duration: 3, toolCallCount, iterationCount: 0, startTime: 0, endTime: 3 } };
}

/** A runtime whose runner runs `script` (a function of the spec) instead of AgentScript. */
function fakeRuntime(
  name: 'interpreter' | 'node-vm',
  script: (spec: CodeCallScriptRunSpec) => Promise<CodeCallRunResult>,
): CodeCallScriptRuntime & { specs: CodeCallScriptRunSpec[]; disposed: number } {
  const runtime = {
    name,
    specs: [] as CodeCallScriptRunSpec[],
    disposed: 0,
    async createRunner(spec: CodeCallScriptRunSpec): Promise<CodeCallScriptRunner> {
      runtime.specs.push(spec);
      return {
        run: () => script(spec),
        dispose: () => {
          runtime.disposed += 1;
        },
      };
    },
  };
  return runtime;
}

function unusedRuntime(name: 'interpreter' | 'node-vm'): CodeCallScriptRuntime {
  return {
    name,
    createRunner: jest.fn(() => Promise.reject(new Error(`the ${name} runtime should not be used`))),
  };
}

describe('EnclaveService runtime selection', () => {
  it('runs scripts in the node-vm runtime when vm.runtime is not set', async () => {
    const nodeVm = fakeRuntime('node-vm', async () => okResult('node'));
    const runtimes: CodeCallScriptRuntimes = { 'node-vm': nodeVm, interpreter: unusedRuntime('interpreter') };
    const service = new EnclaveService(new CodeCallConfig({ vm: { preset: 'secure' } }), undefined, runtimes);

    await expect(service.execute('return 1;', environment())).resolves.toMatchObject({
      success: true,
      result: 'node',
    });
    expect(nodeVm.specs).toHaveLength(1);
    expect(nodeVm.disposed).toBe(1);
  });

  it('runs scripts in the interpreter when vm.runtime selects it', async () => {
    const interpreter = fakeRuntime('interpreter', async () => okResult('interpreted'));
    const runtimes: CodeCallScriptRuntimes = { interpreter, 'node-vm': unusedRuntime('node-vm') };
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, runtimes);

    await expect(service.execute('return 1;', environment())).resolves.toMatchObject({ result: 'interpreted' });
    expect(interpreter.disposed).toBe(1);
  });

  it('refuses an interpreter run when Enclave has no validated runner', async () => {
    const env = environment();
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, {
      interpreter: createInterpreterRuntime(async () => ({})),
      'node-vm': unusedRuntime('node-vm'),
    });

    const result = await service.execute("const t = getTool('a'); return await callTool('a', {});", env);

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        name: 'CodeCallRuntimeError',
        code: 'RUNTIME_UNAVAILABLE',
        runtime: 'interpreter',
        message: expect.stringContaining('AgentScriptRunner'),
      }),
      logs: [],
      timedOut: false,
      stats: { duration: 0, toolCallCount: 0, iterationCount: 0 },
    });
    expect(env.callTool).not.toHaveBeenCalled();
    expect(env.getTool).not.toHaveBeenCalled();
  });

  it('refuses an invalid runtime configuration without running the script', async () => {
    const runtimes: CodeCallScriptRuntimes = {
      interpreter: unusedRuntime('interpreter'),
      'node-vm': unusedRuntime('node-vm'),
    };
    const service = new EnclaveService(configWith({ runtime: 'quickjs' }), undefined, runtimes);

    await expect(service.execute('return 1;', environment())).resolves.toMatchObject({
      success: false,
      error: { name: 'CodeCallRuntimeError', code: 'RUNTIME_CONFIG_INVALID' },
    });
  });

  it('still applies CodeCall policy validation before any runtime is chosen', async () => {
    const runtimes: CodeCallScriptRuntimes = {
      interpreter: unusedRuntime('interpreter'),
      'node-vm': unusedRuntime('node-vm'),
    };
    // Without `vm.allowConsole: true` a script that uses console is refused before it runs.
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, runtimes);

    const result = await service.execute("console.log('x');\nreturn 1;", environment());

    expect(result).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR', name: 'ValidationError' } });
    expect(runtimes.interpreter.createRunner).not.toHaveBeenCalled();
  });

  it('still refuses an oversized script before any runtime is chosen', async () => {
    const runtimes: CodeCallScriptRuntimes = {
      interpreter: unusedRuntime('interpreter'),
      'node-vm': unusedRuntime('node-vm'),
    };
    const service = new EnclaveService(
      configWith(
        { runtime: 'interpreter' },
        { vm: { preset: 'secure' }, sidecar: { enabled: false, maxScriptLengthWhenDisabled: 10 } },
      ),
      undefined,
      runtimes,
    );

    await expect(service.execute('return "a long script";', environment())).rejects.toBeInstanceOf(ScriptTooLargeError);
  });

  it('propagates an unexpected runtime failure rather than reporting it as a refusal', async () => {
    const runtimes: CodeCallScriptRuntimes = {
      interpreter: unusedRuntime('interpreter'),
      'node-vm': { name: 'node-vm', createRunner: () => Promise.reject(new TypeError('boom')) },
    };
    const service = new EnclaveService(new CodeCallConfig({ vm: { preset: 'secure' } }), undefined, runtimes);

    await expect(service.execute('return 1;', environment())).rejects.toThrow('boom');
  });
});

describe('EnclaveService run spec', () => {
  async function specFor(
    runtimeFields: Record<string, unknown>,
    options?: Partial<CodeCallPluginOptions>,
    env: CodeCallVmEnvironment = environment(),
  ): Promise<CodeCallScriptRunSpec> {
    const name = runtimeFields['runtime'] === 'interpreter' ? 'interpreter' : 'node-vm';
    const runtime = fakeRuntime(name, async () => okResult(null));
    const runtimes = { interpreter: runtime, 'node-vm': runtime } as CodeCallScriptRuntimes;
    await new EnclaveService(configWith(runtimeFields, options), undefined, runtimes).execute('return 1;', env);
    const [spec] = runtime.specs;
    if (!spec) throw new Error('the runtime received no spec');
    return spec;
  }

  it('gives the interpreter its budgets and the tool-call budget from vm.maxSteps', async () => {
    const spec = await specFor(
      {
        runtime: 'interpreter',
        maxInterpreterSteps: 1000,
        maxCallDepth: 8,
        maxPendingCalls: 16,
        memoryLimitBytes: 512,
      },
      { vm: { preset: 'secure', timeoutMs: 1234, maxSteps: 9, rapidEnumerationThreshold: 4 } },
    );

    expect(spec).toMatchObject({
      timeoutMs: 1234,
      maxToolCalls: 9,
      maxIterations: 10000,
      maxInterpreterSteps: 1000,
      maxCallDepth: 8,
      maxPendingCalls: 16,
      memoryLimitBytes: 512,
      rapidEnumeration: { threshold: 4 },
    });
  });

  it('gives the Node VM no interpreter budgets', async () => {
    const spec = await specFor({ runtime: 'node-vm', maxInterpreterSteps: 1000, memoryLimitBytes: 512 });

    expect(spec.maxInterpreterSteps).toBeUndefined();
    expect(spec.memoryLimitBytes).toBeUndefined();
    expect(spec.maxToolCalls).toBe(5000);
  });

  it('provides getTool always and mcpLog/mcpNotify only when the environment has them', async () => {
    expect(Object.keys((await specFor({})).hostFunctions)).toEqual(['getTool', 'mcpLog', 'mcpNotify']);
    const bare = await specFor({}, undefined, { callTool: jest.fn(), getTool: jest.fn() });
    expect(Object.keys(bare.hostFunctions)).toEqual(['getTool']);
  });

  it('keeps tool namespaces that collide with a host function out of the sandbox', async () => {
    const spec = await specFor(
      {},
      undefined,
      environment({ toolNamespaces: { getTool: { x: 'getTool.x' }, acme: { run: 'acme.run' } } }),
    );
    expect(spec.toolNamespaces).toEqual({ acme: { run: 'acme.run' } });
  });

  it('passes the sidecar only when it is enabled, and the console only with vm.allowConsole', async () => {
    const off = await specFor({});
    expect(off.sidecar).toBeUndefined();
    expect(off.consoleHandler).toBeUndefined();

    const runtime = fakeRuntime('node-vm', async () => okResult(null));
    const runtimes = { interpreter: runtime, 'node-vm': runtime } as CodeCallScriptRuntimes;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    await new EnclaveService(
      configWith(
        {},
        { vm: { preset: 'secure', allowConsole: true }, sidecar: { enabled: true, maxScriptLengthWhenDisabled: null } },
      ),
      logger as never,
      runtimes,
    ).execute('return 1;', environment());
    expect(runtime.specs[0]?.sidecar).toMatchObject({ enabled: true });
    expect(typeof runtime.specs[0]?.consoleHandler).toBe('function');
  });
});

describe('EnclaveService host functions and tool calls', () => {
  it('answers getTool synchronously and records mcpLog and mcpNotify calls', async () => {
    const env = environment();
    const runtime = fakeRuntime('interpreter', async (spec) => {
      const description = spec.hostFunctions['getTool']?.('a');
      spec.hostFunctions['mcpLog']?.('info', 'hello', { k: 1 });
      spec.hostFunctions['mcpNotify']?.('progress', { done: 1 });
      return okResult(description);
    });
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, {
      interpreter: runtime,
      'node-vm': unusedRuntime('node-vm'),
    });

    const result = await service.execute('return getTool("a");', env);

    expect(result).toMatchObject({
      success: true,
      result: { name: 'a' },
      logs: ['[mcp:info] hello', '[notify] progress'],
    });
    expect(env.getTool).toHaveBeenCalledWith('a');
    expect(env.mcpLog).toHaveBeenCalledWith('info', 'hello', { k: 1 });
    expect(env.mcpNotify).toHaveBeenCalledWith('progress', { done: 1 });
  });

  it('reports a script a failing tool ended as that tool error', async () => {
    const env = environment({
      callTool: jest.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'ToolError', code: 'DENIED' })),
    });
    const runtime = fakeRuntime('interpreter', async (spec) => {
      try {
        await callToolHandler(spec.toolHandler, 'users.get', {});
      } catch (error) {
        const { name, message } = error as Error;
        return { success: false, error: { name, message }, stats: okResult(null, 1).stats };
      }
      return okResult(null);
    });
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, {
      interpreter: runtime,
      'node-vm': unusedRuntime('node-vm'),
    });

    await expect(service.execute("return await callTool('users.get', {});", env)).resolves.toMatchObject({
      success: false,
      error: { name: 'ToolError', message: 'denied', code: 'DENIED', toolName: 'users.get' },
    });
  });

  it("maps a runner's validation refusal to the script's own lines and blocked patterns", async () => {
    const runtime = fakeRuntime('interpreter', async () => ({
      success: false,
      error: {
        name: 'ValidationError',
        message: 'AgentScript validation failed:\nNO_EVAL (line 1): eval is not allowed',
        code: 'VALIDATION_ERROR',
        data: { issues: [{ code: 'NO_EVAL' }, { code: 'NO_EVAL' }] },
      },
      stats: okResult(null).stats,
    }));
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, {
      interpreter: runtime,
      'node-vm': unusedRuntime('node-vm'),
    });

    await expect(service.execute('return 1;', environment())).resolves.toMatchObject({
      success: false,
      error: { name: 'ValidationError', code: 'VALIDATION_ERROR', blockedPatterns: ['NO_EVAL'] },
      timedOut: false,
    });
  });

  it('closes the host side when the run returns: a late continuation reaches no tool or host function', async () => {
    const env = environment();
    let captured: CodeCallScriptRunSpec | undefined;
    const runtime = fakeRuntime('interpreter', async (spec) => {
      captured = spec;
      return okResult('done');
    });
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, {
      interpreter: runtime,
      'node-vm': unusedRuntime('node-vm'),
    });

    await service.execute('return 1;', env);
    if (!captured) throw new Error('the runtime received no spec');

    await expect(callToolHandler(captured.toolHandler, 'users.get', {})).rejects.toBeInstanceOf(ExecutionEndedError);
    expect(() => captured?.hostFunctions['getTool']?.('a')).toThrow(ExecutionEndedError);
    expect(() => captured?.hostFunctions['mcpLog']?.('info', 'late')).toThrow(ExecutionEndedError);
    expect(() => captured?.hostFunctions['mcpNotify']?.('late', {})).toThrow(ExecutionEndedError);
    expect(env.callTool).not.toHaveBeenCalled();
    expect(env.getTool).not.toHaveBeenCalled();
    expect(env.mcpLog).not.toHaveBeenCalled();
    expect(env.mcpNotify).not.toHaveBeenCalled();
  });

  it('closes the host side when the run fails', async () => {
    let captured: CodeCallScriptRunSpec | undefined;
    const runtime = fakeRuntime('interpreter', async (spec) => {
      captured = spec;
      throw new Error('runner crashed');
    });
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, {
      interpreter: runtime,
      'node-vm': unusedRuntime('node-vm'),
    });

    await expect(service.execute('return 1;', environment())).rejects.toThrow('runner crashed');
    expect(() => captured?.hostFunctions['getTool']?.('a')).toThrow(ExecutionEndedError);
    expect(runtime.disposed).toBe(1);
  });

  it('reports the tool calls still running when a run times out', async () => {
    let release: () => void = () => undefined;
    const env = environment({
      callTool: jest.fn(
        () => new Promise<unknown>((resolve) => (release = () => resolve({ late: true }))),
      ) as CodeCallVmEnvironment['callTool'],
    });
    const runtime = fakeRuntime('interpreter', async (spec) => {
      void callToolHandler(spec.toolHandler, 'reports.build', {}).catch(() => undefined);
      return {
        success: false,
        error: { name: 'TimeoutError', message: 'Execution timed out after 10ms', code: 'EXECUTION_TIMEOUT' },
        stats: okResult(null, 1).stats,
      };
    });
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, {
      interpreter: runtime,
      'node-vm': unusedRuntime('node-vm'),
    });

    const result = await service.execute("return await callTool('reports.build', {});", env);
    release();

    expect(result).toMatchObject({ success: false, timedOut: true, stats: { toolCallCount: 1, pendingToolCalls: 1 } });
  });

  it('reports no pending tool calls when every call settled', async () => {
    const runtime = fakeRuntime('interpreter', async (spec) => {
      await callToolHandler(spec.toolHandler, 'a', {});
      return okResult('ok', 1);
    });
    const service = new EnclaveService(configWith({ runtime: 'interpreter' }), undefined, {
      interpreter: runtime,
      'node-vm': unusedRuntime('node-vm'),
    });

    const result = await service.execute("return await callTool('a', {});", environment());
    expect(result.stats).toEqual({ duration: 3, toolCallCount: 1, iterationCount: 0 });
  });
});

/** A real Enclave's first run in a test worker includes its cold start, which a loaded CI host stretches. */
const REAL_ENCLAVE_TIMEOUT_MS = 30000;

describe('EnclaveService on the real node-vm runtime', () => {
  it(
    'lets no continuation of a timed-out script call a tool after the run returned',
    async () => {
      let releaseFirst: () => void = () => undefined;
      const callTool = jest.fn((name: string) =>
        name === 'slow'
          ? new Promise((resolve) => (releaseFirst = () => resolve({ late: true })))
          : Promise.resolve({ ok: true }),
      );
      const service = new EnclaveService(
        new CodeCallConfig({ vm: { preset: 'secure', timeoutMs: 150 } }),
        undefined,
        createDefaultRuntimes(),
      );

      const result = await service.execute(
        "const a = await callTool('slow', {});\nreturn await callTool('after', { a });",
        environment({ callTool: callTool as CodeCallVmEnvironment['callTool'] }),
      );

      expect(result).toMatchObject({ success: false, timedOut: true, stats: { pendingToolCalls: 1 } });

      // The tool answers after the script's result is out: the script's next call reaches nothing.
      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(callTool.mock.calls.map(([name]) => name)).toEqual(['slow']);
    },
    REAL_ENCLAVE_TIMEOUT_MS,
  );
});

describe('EnclaveService on the real interpreter runtime in Node', () => {
  it(
    'runs a tool call and a host lookup through the validated runner',
    async () => {
      const callTool = jest.fn().mockResolvedValue({ id: 7, name: 'user-7' });
      const env = environment({ callTool });
      const service = new EnclaveService(
        new CodeCallConfig({ vm: { preset: 'secure', runtime: 'interpreter', timeoutMs: 5000 } }),
      );

      const result = await service.execute(
        "const user = await callTool('users.get', { id: 7 }); return { user, tool: getTool('users.get').name };",
        env,
      );

      expect(result).toMatchObject({
        success: true,
        result: { user: { id: 7, name: 'user-7' }, tool: 'a' },
      });
      expect(callTool).toHaveBeenCalledWith('users.get', { id: 7 });
    },
    REAL_ENCLAVE_TIMEOUT_MS,
  );
});
