// file: plugins/plugin-codecall/src/__tests__/codecall-runtime.spec.ts
//
// The runtime seam: how `vm.runtime` and its budgets are read, how each runtime loads its Enclave
// entry point and maps a run spec, and how they refuse what they cannot run or enforce.

import * as path from 'node:path';

import { InterpreterAdapter, type ToolHandler } from '@enclave-vm/core/worker';

import { readdir, readFile } from '@frontmcp/utils';

import type { ResolvedCodeCallVmOptions } from '../codecall.symbol';
import CodeCallConfig from '../providers/code-call.config';
import { CodeCallRuntimeError, runtimeSettingsOf, type CodeCallScriptRunSpec } from '../services/runtime';
import { ExecutionEndedError, ExecutionGate } from '../services/runtime/execution-gate';
import {
  AGENT_SCRIPT_RUNNER_EXPORT,
  createInterpreterRuntime,
  maxHostFunctionCallsOf,
  requiredCapabilities,
  toRunnerOptions,
  type AgentScriptRunnerOptions,
} from '../services/runtime/interpreter.runtime';
import { createNodeVmRuntime, isCloudflareWorkersRuntime, toEnclaveOptions } from '../services/runtime/node-vm.runtime';

/** Calls a tool handler as the sandbox does: Enclave 2.21 adds the call's position, which 2.20 ignores. */
function callToolHandler(handler: ToolHandler, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const params = [toolName, args, { callIndex: 0 }] as unknown as Parameters<ToolHandler>;
  return handler(...params);
}

function resolvedVm(extra: Record<string, unknown> = {}): ResolvedCodeCallVmOptions {
  const vm = new CodeCallConfig({ vm: { preset: 'secure' } }).getAll().resolvedVm;
  return { ...vm, ...extra } as ResolvedCodeCallVmOptions;
}

function spec(overrides: Partial<CodeCallScriptRunSpec> = {}): CodeCallScriptRunSpec {
  return {
    timeoutMs: 1000,
    maxIterations: 10000,
    maxToolCalls: 7,
    maxSanitizeDepth: 20,
    maxSanitizeProperties: 500,
    toolHandler: jest.fn(),
    hostFunctions: { getTool: jest.fn() },
    rapidEnumeration: {},
    ...overrides,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<CodeCallRuntimeError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CodeCallRuntimeError);
  return error as CodeCallRuntimeError;
}

/** Run `fn` as if in Cloudflare Workers, whose `navigator.userAgent` is `Cloudflare-Workers`. */
async function inCloudflareWorkers<T>(fn: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Cloudflare-Workers' }, configurable: true });
  try {
    return await fn();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

describe('runtimeSettingsOf', () => {
  it('selects the node-vm runtime when vm.runtime is not set', () => {
    expect(runtimeSettingsOf(resolvedVm())).toMatchObject({ runtime: 'node-vm' });
  });

  it('selects the interpreter when vm.runtime asks for it', () => {
    expect(runtimeSettingsOf(resolvedVm({ runtime: 'interpreter' }))).toMatchObject({ runtime: 'interpreter' });
  });

  it.each([['vm'], ['worker_threads'], [''], [42]])('refuses vm.runtime %p', (runtime) => {
    expect(() => runtimeSettingsOf(resolvedVm({ runtime }))).toThrow(CodeCallRuntimeError);
    try {
      runtimeSettingsOf(resolvedVm({ runtime }));
    } catch (error) {
      expect((error as CodeCallRuntimeError).code).toBe('RUNTIME_CONFIG_INVALID');
    }
  });

  it('keeps vm.maxSteps as the tool-call budget, never an interpreter budget', () => {
    const vm = new CodeCallConfig({ vm: { preset: 'secure', maxSteps: 12 } }).getAll().resolvedVm;
    const settings = runtimeSettingsOf({ ...vm, runtime: 'interpreter' } as ResolvedCodeCallVmOptions);
    expect(settings.maxToolCalls).toBe(12);
    expect(settings.maxInterpreterSteps).not.toBe(12);
  });

  it('reads the tool-call budget from the resolved vm.maxToolCalls', () => {
    expect(runtimeSettingsOf(resolvedVm({ maxToolCalls: 3 })).maxToolCalls).toBe(3);
  });

  it('carries the interpreter budgets', () => {
    expect(
      runtimeSettingsOf(
        resolvedVm({
          runtime: 'interpreter',
          maxInterpreterSteps: 1000,
          maxCallDepth: 32,
          maxPendingCalls: 64,
          memoryLimitBytes: 1024,
        }),
      ),
    ).toEqual({
      runtime: 'interpreter',
      maxToolCalls: 5000,
      maxInterpreterSteps: 1000,
      maxCallDepth: 32,
      maxPendingCalls: 64,
      memoryLimitBytes: 1024,
    });
  });

  it.each([
    ['maxInterpreterSteps', 0],
    ['maxCallDepth', -1],
    ['maxPendingCalls', Number.POSITIVE_INFINITY],
    ['memoryLimitBytes', 1.5],
    ['maxToolCalls', Number.NaN],
    ['maxInterpreterSteps', '1000'],
  ])('refuses %s = %p rather than treating it as unlimited', (option, value) => {
    let error: unknown;
    try {
      runtimeSettingsOf(resolvedVm({ runtime: 'interpreter', [option]: value }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CodeCallRuntimeError);
    expect((error as CodeCallRuntimeError).code).toBe('RUNTIME_CONFIG_INVALID');
    expect((error as CodeCallRuntimeError).message).toContain(`vm.${option}`);
  });
});

describe('node-vm runtime', () => {
  it('maps a run spec to the Enclave options CodeCall has always used, with the security level pinned', () => {
    const toolHandler = jest.fn();
    const getTool = jest.fn();
    const options = toEnclaveOptions(
      spec({
        toolHandler,
        hostFunctions: { getTool },
        toolNamespaces: { acme: { run: 'acme.run' } },
        rapidEnumeration: { threshold: 9, overrides: { 'acme.run': 2 } },
        // Interpreter budgets have no Node VM counterpart.
        maxInterpreterSteps: 5,
        memoryLimitBytes: 2048,
      }),
    );

    expect(options).toMatchObject({
      securityLevel: 'STANDARD',
      timeout: 1000,
      maxToolCalls: 7,
      maxIterations: 10000,
      maxSanitizeDepth: 20,
      maxSanitizeProperties: 500,
      validate: true,
      transform: true,
      sanitizeStackTraces: true,
      allowFunctionsInGlobals: true,
      toolHandler,
      globals: { getTool },
      toolNamespaces: { acme: { run: 'acme.run' } },
      doubleVm: { parentValidation: { rapidEnumerationThreshold: 9, rapidEnumerationOverrides: { 'acme.run': 2 } } },
    });
    expect(options).not.toHaveProperty('memoryLimit');
    expect(options).not.toHaveProperty('maxSteps');
    expect(options).not.toHaveProperty('sandboxAdapter');
    expect(options).not.toHaveProperty('adapter');
  });

  it('leaves the rapid-enumeration defaults to the sandbox when none are configured', () => {
    expect(toEnclaveOptions(spec()).doubleVm).toEqual({ parentValidation: {} });
  });

  it('refuses in Cloudflare Workers without loading the Node barrel', async () => {
    const loader = jest.fn();
    const error = await inCloudflareWorkers(() => refusalOf(createNodeVmRuntime(loader).createRunner(spec())));

    expect(error.code).toBe('RUNTIME_UNAVAILABLE');
    expect(error.runtime).toBe('node-vm');
    expect(error.message).toContain('not available in Cloudflare Workers');
    expect(error.message).toContain("vm.runtime: 'interpreter'");
    expect(loader).not.toHaveBeenCalled();
  });

  it('recognizes Cloudflare Workers only by its own user agent', async () => {
    expect(isCloudflareWorkersRuntime()).toBe(false);
    await inCloudflareWorkers(async () => expect(isCloudflareWorkersRuntime()).toBe(true));
  });

  it('refuses when the Node barrel cannot be loaded', async () => {
    const error = await refusalOf(
      createNodeVmRuntime(() => Promise.reject(new Error('No such module "@enclave-vm/core"'))).createRunner(spec()),
    );
    expect(error.code).toBe('RUNTIME_UNAVAILABLE');
    expect(error.message).toContain('could not load @enclave-vm/core');
  });

  it('refuses a barrel without an Enclave', async () => {
    const error = await refusalOf(createNodeVmRuntime(async () => ({}) as never).createRunner(spec()));
    expect(error.code).toBe('RUNTIME_UNAVAILABLE');
    expect(error.message).toContain('exports no Enclave');
  });

  it('runs a script through the real Enclave and disposes it', async () => {
    const runner = await createNodeVmRuntime().createRunner(spec());
    try {
      await expect(runner.run('return 1 + 1;')).resolves.toMatchObject({ success: true, value: 2 });
    } finally {
      runner.dispose();
    }
  }, 30000);

  it('refuses a reviewed run on an Enclave that would ignore the review hooks', async () => {
    const Enclave = jest.fn();
    const error = await refusalOf(
      createNodeVmRuntime(async () => ({ Enclave }) as never).createRunner(spec({ review: { pre: jest.fn() } })),
    );

    expect(error.code).toBe('RUNTIME_FEATURE_UNSUPPORTED');
    expect(error.message).toContain('2.21 or later');
    expect(Enclave).not.toHaveBeenCalled();
  });

  it("gives the real Enclave the review hooks and the run's review context", async () => {
    const pre = jest.fn(async () => ({ decision: 'denied' as const, reason: 'no scripts today' }));
    const runner = await createNodeVmRuntime().createRunner(
      spec({ review: { pre }, reviewContext: { session: 's-1' } }),
    );
    try {
      const result = await runner.run('return 1;');

      expect(result).toMatchObject({ success: false, error: { code: 'REVIEW_DENIED' } });
      expect(result.review?.decisions).toEqual([expect.objectContaining({ phase: 'script', decision: 'denied' })]);
      expect(pre).toHaveBeenCalledWith(expect.objectContaining({ phase: 'script', context: { session: 's-1' } }));
    } finally {
      runner.dispose();
    }
  }, 30000);
});

describe('interpreter runtime', () => {
  const fullCapabilities = [
    'validated-agentscript',
    'host-functions',
    'tool-namespaces',
    'sidecar',
    'console',
    'rapid-enumeration',
    'review',
    'kept-references',
  ];

  function fakeRunnerEntry(capabilities: readonly string[] = fullCapabilities) {
    const constructed: AgentScriptRunnerOptions[] = [];
    const run = jest.fn().mockResolvedValue({
      success: true,
      value: 'ran',
      stats: { duration: 1, toolCallCount: 0, iterationCount: 0, startTime: 0, endTime: 1 },
    });
    const dispose = jest.fn();
    class FakeRunner {
      static readonly capabilities = capabilities;
      constructor(options: AgentScriptRunnerOptions) {
        constructed.push(options);
      }
      run = run;
      dispose = dispose;
    }
    return { entry: { [AGENT_SCRIPT_RUNNER_EXPORT]: FakeRunner }, constructed, run, dispose };
  }

  it('refuses a worker entry without the validated runner and never uses the bare adapter', async () => {
    const execute = jest.spyOn(InterpreterAdapter.prototype, 'execute');
    try {
      const error = await refusalOf(
        createInterpreterRuntime(async () => ({ InterpreterAdapter })).createRunner(spec()),
      );

      expect(error.code).toBe('RUNTIME_UNAVAILABLE');
      expect(error.runtime).toBe('interpreter');
      expect(error.message).toContain(`${AGENT_SCRIPT_RUNNER_EXPORT} from @enclave-vm/core/worker`);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
    }
  });

  it('refuses an export that is not a runner class with capabilities', async () => {
    const error = await refusalOf(
      createInterpreterRuntime(async () => ({ [AGENT_SCRIPT_RUNNER_EXPORT]: class {} })).createRunner(spec()),
    );
    expect(error.code).toBe('RUNTIME_UNAVAILABLE');
  });

  it('refuses when the worker entry cannot be loaded', async () => {
    const error = await refusalOf(createInterpreterRuntime(() => Promise.reject(new Error('x'))).createRunner(spec()));
    expect(error.code).toBe('RUNTIME_UNAVAILABLE');
    expect(error.message).toContain('could not load @enclave-vm/core/worker');
  });

  it('requires validation, host functions and the rapid-enumeration policy for every run', () => {
    expect(requiredCapabilities(spec())).toEqual(['validated-agentscript', 'host-functions', 'rapid-enumeration']);
  });

  it('requires namespaces, the sidecar and the console only when the run uses them', () => {
    expect(
      requiredCapabilities(
        spec({
          toolNamespaces: { acme: { run: 'acme.run' } },
          sidecar: { enabled: true },
          consoleHandler: jest.fn(),
          review: { pre: jest.fn() },
          preloadReferences: [],
        }),
      ),
    ).toEqual([
      'validated-agentscript',
      'host-functions',
      'rapid-enumeration',
      'tool-namespaces',
      'sidecar',
      'console',
      'review',
      'kept-references',
    ]);
    expect(requiredCapabilities(spec({ toolNamespaces: {} }))).not.toContain('tool-namespaces');
  });

  it.each([
    ['validated-agentscript', {}],
    ['host-functions', {}],
    ['rapid-enumeration', {}],
    ['console', { consoleHandler: jest.fn() }],
    ['sidecar', { sidecar: { enabled: true } }],
    ['tool-namespaces', { toolNamespaces: { acme: { run: 'acme.run' } } }],
    ['review', { review: { pre: jest.fn() } }],
  ] as Array<[string, Partial<CodeCallScriptRunSpec>]>)(
    'refuses a run that needs %s from a runner that does not enforce it',
    async (capability, overrides) => {
      const { entry, constructed } = fakeRunnerEntry(fullCapabilities.filter((c) => c !== capability));
      const error = await refusalOf(createInterpreterRuntime(async () => entry).createRunner(spec(overrides)));

      expect(error.code).toBe('RUNTIME_FEATURE_UNSUPPORTED');
      expect(error.message).toContain(capability);
      expect(constructed).toHaveLength(0);
    },
  );

  it('maps a run spec to the runner options with every budget finite', () => {
    const toolHandler = jest.fn();
    const getTool = jest.fn();
    const consoleHandler = jest.fn();
    expect(
      toRunnerOptions(
        spec({
          toolHandler,
          hostFunctions: { getTool },
          consoleHandler,
          maxInterpreterSteps: 1000,
          maxCallDepth: 16,
          maxPendingCalls: 32,
          memoryLimitBytes: 4096,
          sidecar: { enabled: true, maxTotalSize: 10 },
          rapidEnumeration: { threshold: 4 },
        }),
      ),
    ).toEqual({
      securityLevel: 'STANDARD',
      timeout: 1000,
      maxToolCalls: 7,
      maxIterations: 10000,
      maxSteps: 1000,
      maxCallDepth: 16,
      maxPendingCalls: 32,
      memoryLimit: 4096,
      maxSanitizeDepth: 20,
      maxSanitizeProperties: 500,
      sanitizeStackTraces: true,
      toolHandler,
      hostFunctions: { getTool },
      maxHostFunctionCalls: 70,
      consoleHandler,
      toolNamespaces: undefined,
      sidecar: { enabled: true, maxTotalSize: 10 },
      rapidEnumeration: { threshold: 4 },
    });
    expect(maxHostFunctionCallsOf(3)).toBe(30);
  });

  it('gives the runner the review hooks only when the run is reviewed, and the review context to each run', async () => {
    const review = { pre: jest.fn() };
    expect(toRunnerOptions(spec({ review })).review).toBe(review);
    expect(toRunnerOptions(spec())).not.toHaveProperty('review');

    const { entry, run } = fakeRunnerEntry();
    const runner = await createInterpreterRuntime(async () => entry).createRunner(
      spec({ review, reviewContext: { session: 's-1' } }),
    );
    await runner.run('return 1;');
    expect(run).toHaveBeenCalledWith('return 1;', undefined, { reviewContext: { session: 's-1' } });
  });

  it('gives a run the sidecar entries it starts with', async () => {
    const preloadReferences = [
      { id: '__REF_0b8e2f6a-1c2d-4e5f-8a9b-0c1d2e3f4a5b__', data: 'doc', source: 'tool-result' as const },
    ];
    const { entry, run } = fakeRunnerEntry();
    const runner = await createInterpreterRuntime(async () => entry).createRunner(
      spec({ sidecar: { enabled: true }, preloadReferences }),
    );
    await runner.run('return 1;');

    expect(run).toHaveBeenCalledWith('return 1;', undefined, { reviewContext: undefined, preloadReferences });
  });

  it('runs raw AgentScript through the runner and disposes it', async () => {
    const { entry, constructed, run, dispose } = fakeRunnerEntry();
    const runner = await createInterpreterRuntime(async () => entry).createRunner(spec());

    await expect(runner.run('return 1;')).resolves.toMatchObject({ success: true, value: 'ran' });
    runner.dispose();

    expect(constructed).toHaveLength(1);
    expect(run).toHaveBeenCalledWith('return 1;', undefined, { reviewContext: undefined });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('runs without namespaces when the runner refuses them, as the Node VM does', async () => {
    const constructed: AgentScriptRunnerOptions[] = [];
    class RefusingRunner {
      static readonly capabilities = fullCapabilities;
      constructor(options: AgentScriptRunnerOptions) {
        constructed.push(options);
        if (options.toolNamespaces) throw new TypeError('Invalid toolNamespaces: "x"');
      }
      run = jest.fn();
      dispose = jest.fn();
    }
    await createInterpreterRuntime(async () => ({ [AGENT_SCRIPT_RUNNER_EXPORT]: RefusingRunner })).createRunner(
      spec({ toolNamespaces: { x: { run: 'x.run' } } }),
    );
    expect(constructed).toHaveLength(2);
    expect(constructed[1]?.toolNamespaces).toBeUndefined();
  });

  it('propagates any other construction error', async () => {
    class BrokenRunner {
      static readonly capabilities = fullCapabilities;
      constructor() {
        throw new TypeError('something else');
      }
    }
    await expect(
      createInterpreterRuntime(async () => ({ [AGENT_SCRIPT_RUNNER_EXPORT]: BrokenRunner })).createRunner(
        spec({ toolNamespaces: { x: { run: 'x.run' } } }),
      ),
    ).rejects.toThrow('something else');
  });
});

describe('ExecutionGate', () => {
  it('passes calls through while open and refuses them once closed', async () => {
    const gate = new ExecutionGate();
    const handler = jest.fn().mockResolvedValue('ok');
    const fn = jest.fn().mockReturnValue('value');
    const guardedHandler = gate.guardToolHandler(handler);
    const guardedFn = gate.guardHostFunction('getTool', fn);

    await expect(callToolHandler(guardedHandler, 'a', {})).resolves.toBe('ok');
    expect(guardedFn('x')).toBe('value');
    expect(gate.isOpen).toBe(true);

    gate.close();

    expect(gate.isOpen).toBe(false);
    await expect(callToolHandler(guardedHandler, 'a', {})).rejects.toBeInstanceOf(ExecutionEndedError);
    expect(() => guardedFn('x')).toThrow(ExecutionEndedError);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reports the tool calls still in flight when it closes, and keeps the first report', async () => {
    const gate = new ExecutionGate();
    let finish: (value: unknown) => void = () => undefined;
    const handler = gate.guardToolHandler(() => new Promise((resolve) => (finish = resolve)));
    const settled = gate.guardToolHandler(async () => 'done');

    await callToolHandler(settled, 'done', {});
    const pending = callToolHandler(handler, 'slow', {});

    expect(gate.close()).toEqual({ pendingToolCalls: 1 });
    finish('late');
    await expect(pending).resolves.toBe('late');
    expect(gate.close()).toEqual({ pendingToolCalls: 1 });
  });

  it('names the refused target and carries a code', () => {
    const error = new ExecutionEndedError('getTool');
    expect(error.name).toBe('ExecutionEndedError');
    expect(error.code).toBe('EXECUTION_ENDED');
    expect(error.message).toContain('getTool');
  });
});

describe('the Node-only barrel stays out of the execution path', () => {
  const servicesDir = path.join(__dirname, '..', 'services');
  const runtimeDir = path.join(servicesDir, 'runtime');
  const valueImportOfBarrel = /^import\s+(?!type\b)[^;]*?from\s+'@enclave-vm\/core';/m;
  const dynamicLoadOfBarrel = /(?:import|require)\(\s*'@enclave-vm\/core'\s*\)/;

  it('imports @enclave-vm/core only as types in the execution service and every runtime', async () => {
    const runtimeFiles = (await readdir(runtimeDir)).map((file) => path.join(runtimeDir, file));
    const files = [path.join(servicesDir, 'enclave.service.ts'), ...runtimeFiles].filter((file) =>
      file.endsWith('.ts'),
    );

    const filesLoadingBarrel: string[] = [];
    for (const file of files) {
      const source = await readFile(file);
      if (valueImportOfBarrel.test(source) || dynamicLoadOfBarrel.test(source)) {
        filesLoadingBarrel.push(path.relative(servicesDir, file));
      }
    }

    expect(files.length).toBeGreaterThan(1);
    expect(filesLoadingBarrel).toEqual([]);
  });
});
