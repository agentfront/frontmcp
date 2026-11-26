// file: libs/plugins/src/codecall/__tests__/codecall-options.spec.ts

import {
  codeCallPluginOptionsSchema,
  DEFAULT_RUNS_MEMORY_MAX_ENTRIES,
  INTERPRETER_BUDGET_LIMITS,
  MAX_TOOL_CALLS,
  type CodeCallInterpreterBudget,
} from '../codecall.types';
import {
  maxToolCallsOf,
  rapidEnumerationThresholdOf,
  resolveVmOptions,
  vmRuntimeUnavailableReason,
} from '../providers/code-call.config';

/** The `vm` options with every default applied, as the plugin resolves them. */
function resolvedVmOf(vm: unknown) {
  return resolveVmOptions(codeCallPluginOptionsSchema.parse({ vm }).vm);
}

/** The messages of the issues refusing `vm`, or [] when it parses. */
function vmIssues(vm: unknown): string[] {
  const parsed = codeCallPluginOptionsSchema.safeParse({ vm });
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

const INTERPRETER_BUDGETS = Object.keys(INTERPRETER_BUDGET_LIMITS) as CodeCallInterpreterBudget[];

describe('CodeCallPluginOptions Zod Schema', () => {
  describe('default values', () => {
    it('should apply defaults for empty options', () => {
      const parsed = codeCallPluginOptionsSchema.parse({});

      expect(parsed.mode).toBe('codecall_only');
      expect(parsed.topK).toBe(8);
      expect(parsed.maxDefinitions).toBe(8);
      expect(parsed.vm.preset).toBe('secure');
      expect(parsed.embedding.strategy).toBe('tfidf');
      expect(parsed.embedding.modelName).toBe('Xenova/all-MiniLM-L6-v2');
      expect(parsed.embedding.cacheDir).toBe('./.cache/transformers');
      expect(parsed.embedding.useHNSW).toBe(false);
    });

    it('refuses a fractional or non-positive maxDefinitions', () => {
      expect(codeCallPluginOptionsSchema.safeParse({ maxDefinitions: 2.5 }).success).toBe(false);
      expect(codeCallPluginOptionsSchema.safeParse({ maxDefinitions: 0 }).success).toBe(false);
    });

    it('should preserve user-provided values and apply remaining defaults', () => {
      const parsed = codeCallPluginOptionsSchema.parse({
        mode: 'codecall_opt_in',
        topK: 15,
        vm: {
          preset: 'locked_down',
          timeoutMs: 1000,
        },
      });

      expect(parsed.mode).toBe('codecall_opt_in');
      expect(parsed.topK).toBe(15);
      expect(parsed.maxDefinitions).toBe(8); // default
      expect(parsed.vm.preset).toBe('locked_down');
      expect(parsed.vm.timeoutMs).toBe(1000);
      expect(parsed.embedding.strategy).toBe('tfidf'); // default
      expect(parsed.embedding.modelName).toBe('Xenova/all-MiniLM-L6-v2'); // default
    });

    it('should apply VM preset-specific defaults', () => {
      const parsedSecure = codeCallPluginOptionsSchema.parse({
        vm: { preset: 'secure' },
      });
      expect(parsedSecure.vm.preset).toBe('secure');

      const parsedBalanced = codeCallPluginOptionsSchema.parse({
        vm: { preset: 'balanced' },
      });
      expect(parsedBalanced.vm.preset).toBe('balanced');

      const parsedExperimental = codeCallPluginOptionsSchema.parse({
        vm: { preset: 'experimental' },
      });
      expect(parsedExperimental.vm.preset).toBe('experimental');

      const parsedLockedDown = codeCallPluginOptionsSchema.parse({
        vm: { preset: 'locked_down' },
      });
      expect(parsedLockedDown.vm.preset).toBe('locked_down');
    });
  });

  describe('vm rapid-enumeration limits', () => {
    it("leave the sandbox's default of 30 calls to one tool when unset", () => {
      const resolved = resolveVmOptions(codeCallPluginOptionsSchema.parse({}).vm);

      expect(resolved.rapidEnumerationThreshold).toBeUndefined();
      expect(resolved.rapidEnumerationOverrides).toBeUndefined();
      expect(rapidEnumerationThresholdOf(resolved)).toBe(30);
    });

    it('carry a configured threshold and per-tool overrides through', () => {
      const parsed = codeCallPluginOptionsSchema.parse({
        vm: { rapidEnumerationThreshold: 50, rapidEnumerationOverrides: { 'users:get': 100 } },
      });
      const resolved = resolveVmOptions(parsed.vm);

      expect(resolved.rapidEnumerationThreshold).toBe(50);
      expect(resolved.rapidEnumerationOverrides).toEqual({ 'users:get': 100 });
      expect(rapidEnumerationThresholdOf(resolved)).toBe(50);
    });

    it('refuse a fractional or non-positive threshold', () => {
      expect(codeCallPluginOptionsSchema.safeParse({ vm: { rapidEnumerationThreshold: 0 } }).success).toBe(false);
      expect(codeCallPluginOptionsSchema.safeParse({ vm: { rapidEnumerationThreshold: 2.5 } }).success).toBe(false);
      expect(
        codeCallPluginOptionsSchema.safeParse({ vm: { rapidEnumerationOverrides: { 'users:get': -1 } } }).success,
      ).toBe(false);
    });
  });

  describe('validation', () => {
    it('should reject invalid mode', () => {
      expect(() => {
        codeCallPluginOptionsSchema.parse({
          mode: 'invalid_mode',
        });
      }).toThrow();
    });

    it('should reject invalid VM preset', () => {
      expect(() => {
        codeCallPluginOptionsSchema.parse({
          vm: { preset: 'invalid_preset' },
        });
      }).toThrow();
    });

    it('should reject negative topK', () => {
      expect(() => {
        codeCallPluginOptionsSchema.parse({
          topK: -5,
        });
      }).toThrow();
    });

    it('should reject zero topK', () => {
      expect(() => {
        codeCallPluginOptionsSchema.parse({
          topK: 0,
        });
      }).toThrow();
    });

    it('should accept valid custom options', () => {
      const parsed = codeCallPluginOptionsSchema.parse({
        mode: 'metadata_driven',
        topK: 10,
        maxDefinitions: 15,
        vm: {
          preset: 'balanced',
          timeoutMs: 5000,
          allowLoops: true,
          maxSteps: 10000,
          allowConsole: false,
          disabledBuiltins: ['eval'],
          disabledGlobals: ['process'],
        },
        embedding: {
          strategy: 'ml',
          modelName: 'custom/model',
          cacheDir: '/custom/cache',
          useHNSW: true,
        },
      });

      expect(parsed).toBeDefined();
      expect(parsed.mode).toBe('metadata_driven');
      expect(parsed.topK).toBe(10);
      expect(parsed.maxDefinitions).toBe(15);
      expect(parsed.vm.preset).toBe('balanced');
      expect(parsed.vm.timeoutMs).toBe(5000);
      expect(parsed.vm.allowLoops).toBe(true);
      expect(parsed.vm.maxSteps).toBe(10000);
      expect(parsed.vm.allowConsole).toBe(false);
      expect(parsed.vm.disabledBuiltins).toEqual(['eval']);
      expect(parsed.vm.disabledGlobals).toEqual(['process']);
      expect(parsed.embedding.strategy).toBe('ml');
      expect(parsed.embedding.modelName).toBe('custom/model');
      expect(parsed.embedding.cacheDir).toBe('/custom/cache');
      expect(parsed.embedding.useHNSW).toBe(true);
    });
  });

  describe('directCalls configuration', () => {
    it('should accept valid directCalls configuration', () => {
      const parsed = codeCallPluginOptionsSchema.parse({
        directCalls: {
          enabled: true,
          allowedTools: ['tool1', 'tool2'],
        },
      });

      expect(parsed.directCalls).toBeDefined();
      expect(parsed.directCalls?.enabled).toBe(true);
      expect(parsed.directCalls?.allowedTools).toEqual(['tool1', 'tool2']);
    });

    it('should handle directCalls with custom filter function', () => {
      const filterFn = (tool: { name: string }) => tool.name.startsWith('test:');

      const parsed = codeCallPluginOptionsSchema.parse({
        directCalls: {
          enabled: true,
          filter: filterFn,
        },
      });

      expect(parsed.directCalls).toBeDefined();
      expect(typeof parsed.directCalls?.filter).toBe('function');
      // Test that the function works correctly
      expect(parsed.directCalls?.filter?.({ name: 'test:tool', appId: 'app', source: 'src', tags: [] })).toBe(true);
      expect(parsed.directCalls?.filter?.({ name: 'other:tool', appId: 'app', source: 'src', tags: [] })).toBe(false);
    });
  });

  describe('includeTools configuration', () => {
    it('should accept includeTools filter function', () => {
      const includeFn = (tool: { name: string; tags?: string[] }) => tool.tags?.includes('production') || false;

      const parsed = codeCallPluginOptionsSchema.parse({
        includeTools: includeFn,
      });

      expect(typeof parsed.includeTools).toBe('function');
      // Test that the function works correctly
      expect(
        parsed.includeTools?.({
          name: 'tool1',
          appId: 'app',
          source: 'src',
          description: 'desc',
          tags: ['production'],
        }),
      ).toBe(true);
      expect(
        parsed.includeTools?.({ name: 'tool2', appId: 'app', source: 'src', description: 'desc', tags: ['dev'] }),
      ).toBe(false);
    });
  });
});

describe('CodeCall vm runtime and budgets', () => {
  describe('defaults', () => {
    it('resolve to the node-vm runtime, the preset tool-call budget and the interpreter defaults', () => {
      const resolved = resolvedVmOf(undefined);

      expect(resolved.runtime).toBe('node-vm');
      expect(resolved.maxToolCalls).toBe(5000);
      expect(maxToolCallsOf(resolved)).toBe(5000);
      expect(resolved.maxInterpreterSteps).toBe(1_000_000);
      expect(resolved.memoryLimitBytes).toBe(1024 * 1024);
      expect(resolved.maxCallDepth).toBe(256);
      expect(resolved.maxPendingCalls).toBe(4096);
      expect(resolved).not.toHaveProperty('maxSteps');
    });

    it.each([
      ['locked_down', 2000],
      ['secure', 5000],
      ['balanced', 10000],
      ['experimental', 20000],
    ] as const)('keep the %s preset tool-call budget (%i) and never choose the runtime', (preset, maxToolCalls) => {
      const resolved = resolvedVmOf({ preset });

      expect(resolved.maxToolCalls).toBe(maxToolCalls);
      expect(resolved.runtime).toBe('node-vm');
    });

    it('leave out an option given as undefined instead of overriding the preset with it', () => {
      const resolved = resolvedVmOf({ preset: 'balanced', timeoutMs: undefined, maxSanitizeDepth: undefined });

      expect(resolved.timeoutMs).toBe(5000);
      expect(resolved.maxSanitizeDepth).toBe(50);
    });
  });

  describe('vm.runtime', () => {
    it('carries an explicit interpreter selection and its budgets through, the preset policy unchanged', () => {
      const resolved = resolvedVmOf({
        preset: 'secure',
        runtime: 'interpreter',
        maxInterpreterSteps: 200_000,
        memoryLimitBytes: 4 * 1024 * 1024,
        maxCallDepth: 64,
        maxPendingCalls: 512,
      });

      expect(resolved).toMatchObject({
        runtime: 'interpreter',
        maxInterpreterSteps: 200_000,
        memoryLimitBytes: 4 * 1024 * 1024,
        maxCallDepth: 64,
        maxPendingCalls: 512,
        preset: 'secure',
        timeoutMs: 3500,
        allowLoops: false,
        maxToolCalls: 5000,
      });
    });

    it('applies the interpreter defaults to an interpreter selection that sets no budget', () => {
      const resolved = resolvedVmOf({ runtime: 'interpreter' });

      expect(resolved.maxInterpreterSteps).toBe(INTERPRETER_BUDGET_LIMITS.maxInterpreterSteps.default);
      expect(resolved.memoryLimitBytes).toBe(INTERPRETER_BUDGET_LIMITS.memoryLimitBytes.default);
    });

    it('accepts an explicit node-vm', () => {
      expect(resolvedVmOf({ runtime: 'node-vm' }).runtime).toBe('node-vm');
    });

    it.each(['worker_threads', 'isolated-vm', 'quickjs', '', 'NODE-VM'])('refuses the runtime %p', (runtime) => {
      expect(vmIssues({ runtime })).not.toEqual([]);
    });
  });

  describe('vm.maxToolCalls and its deprecated alias vm.maxSteps', () => {
    it('reads vm.maxSteps as the tool-call budget, never as interpreter steps', () => {
      const resolved = resolvedVmOf({ maxSteps: 40 });

      expect(resolved.maxToolCalls).toBe(40);
      expect(maxToolCallsOf(resolved)).toBe(40);
      expect(resolved.maxInterpreterSteps).toBe(INTERPRETER_BUDGET_LIMITS.maxInterpreterSteps.default);
    });

    it('takes vm.maxToolCalls', () => {
      expect(resolvedVmOf({ preset: 'locked_down', maxToolCalls: 12 }).maxToolCalls).toBe(12);
    });

    it('accepts both names set to the same value', () => {
      expect(resolvedVmOf({ maxSteps: 25, maxToolCalls: 25 }).maxToolCalls).toBe(25);
    });

    it('refuses both names set to different values', () => {
      expect(vmIssues({ maxSteps: 10, maxToolCalls: 20 })).toEqual([
        'vm.maxSteps is the deprecated name of vm.maxToolCalls, and they differ (10 and 20): set only vm.maxToolCalls',
      ]);
    });

    it.each(['maxToolCalls', 'maxSteps'])('bounds vm.%s to a finite integer from 1 to MAX_TOOL_CALLS', (name) => {
      for (const invalid of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_TOOL_CALLS + 1, '10']) {
        expect(vmIssues({ [name]: invalid })).not.toEqual([]);
      }
      expect(resolvedVmOf({ [name]: MAX_TOOL_CALLS }).maxToolCalls).toBe(MAX_TOOL_CALLS);
      expect(resolvedVmOf({ [name]: 1 }).maxToolCalls).toBe(1);
    });
  });

  describe('interpreter budgets', () => {
    it.each(INTERPRETER_BUDGETS)('bound vm.%s to a finite integer from 1 to its maximum', (budget) => {
      const { max } = INTERPRETER_BUDGET_LIMITS[budget];
      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, max + 1]) {
        expect(vmIssues({ runtime: 'interpreter', [budget]: invalid })).not.toEqual([]);
      }
      expect(resolvedVmOf({ runtime: 'interpreter', [budget]: max })[budget]).toBe(max);
      expect(resolvedVmOf({ runtime: 'interpreter', [budget]: 1 })[budget]).toBe(1);
    });

    it.each(INTERPRETER_BUDGETS)('refuse vm.%s with an explicit node-vm, which does not enforce it', (budget) => {
      expect(vmIssues({ runtime: 'node-vm', [budget]: 1 })).toEqual([
        `vm.${budget} applies only to vm.runtime 'interpreter'; the 'node-vm' runtime does not enforce it`,
      ]);
    });

    it.each(INTERPRETER_BUDGETS)('refuse vm.%s when vm.runtime is unset, which runs node-vm', (budget) => {
      expect(vmIssues({ [budget]: 1 })).toEqual([
        `vm.${budget} applies only to vm.runtime 'interpreter'; the 'node-vm' runtime does not enforce it`,
      ]);
    });

    it("keep their maxima at Enclave's interpreter defaults and ceiling", () => {
      expect(INTERPRETER_BUDGET_LIMITS.maxInterpreterSteps.max).toBe(5_000_000);
      expect(INTERPRETER_BUDGET_LIMITS.memoryLimitBytes.max).toBe(64 * 1024 * 1024);
      expect(INTERPRETER_BUDGET_LIMITS.maxCallDepth.max).toBe(256);
      expect(INTERPRETER_BUDGET_LIMITS.maxPendingCalls.max).toBe(4096);
      for (const budget of INTERPRETER_BUDGETS) {
        const { default: fallback, max } = INTERPRETER_BUDGET_LIMITS[budget];
        expect(fallback).toBeLessThanOrEqual(max);
      }
    });
  });

  describe('vmRuntimeUnavailableReason', () => {
    it.each(['node', 'unknown', 'cli', 'distributed'])('lets node-vm run in a %s build', (target) => {
      expect(vmRuntimeUnavailableReason('node-vm', target)).toBeUndefined();
    });

    it('refuses node-vm in a Cloudflare Workers build', () => {
      expect(vmRuntimeUnavailableReason('node-vm', 'cloudflare')).toBe(
        "CodeCall vm.runtime 'node-vm' needs Node's vm module, which Cloudflare Workers do not provide (nodejs_compat only stubs it): use vm.runtime 'interpreter'",
      );
    });

    it.each(['node', 'cloudflare'])('allows the interpreter in a %s build', (target) => {
      expect(vmRuntimeUnavailableReason('interpreter', target)).toBeUndefined();
    });
  });
});

describe('CodeCall runs options', () => {
  it('keeps run records by default, for 600 seconds, up to 256 KiB each, with results', () => {
    expect(codeCallPluginOptionsSchema.parse({}).runs).toEqual({
      enabled: true,
      ttlSeconds: 600,
      maxRecordBytes: 256 * 1024,
      resume: true,
      storage: { type: 'auto', memory: { maxEntries: DEFAULT_RUNS_MEMORY_MAX_ENTRIES } },
      namespace: 'codecall-runs',
    });
  });

  it("keeps a storage's own memory limit", () => {
    const { storage } = codeCallPluginOptionsSchema.parse({
      runs: { storage: { type: 'memory', memory: { maxEntries: 10 } } },
    }).runs;
    expect(storage).toEqual({ type: 'memory', memory: { maxEntries: 10 } });
  });

  it.each([
    ['a ttlSeconds below 1', { ttlSeconds: 0 }],
    ['a maxRecordBytes below 1024', { maxRecordBytes: 512 }],
    ['a storage that is not an object', { storage: 'redis' }],
    ['an empty namespace', { namespace: '' }],
  ])('refuses %s', (_, runs) => {
    expect(() => codeCallPluginOptionsSchema.parse({ runs })).toThrow();
  });
});

describe('CodeCall keep options', () => {
  it('gives scripts keep and recall by default, for 600 seconds, up to 1 MiB an owner', () => {
    expect(codeCallPluginOptionsSchema.parse({}).keep).toEqual({
      enabled: true,
      ttlSeconds: 600,
      maxBytes: 1024 * 1024,
      storage: { type: 'auto', memory: { maxEntries: DEFAULT_RUNS_MEMORY_MAX_ENTRIES } },
      namespace: 'codecall-kept',
    });
  });

  it.each([
    ['a ttlSeconds below 1', { ttlSeconds: 0 }],
    ['a maxBytes below 1024', { maxBytes: 512 }],
    ['a storage that is not an object', { storage: 'redis' }],
    ['an empty namespace', { namespace: '' }],
  ])('refuses %s', (_, keep) => {
    expect(() => codeCallPluginOptionsSchema.parse({ keep })).toThrow();
  });
});

describe('CodeCall trace options', () => {
  it('lists the calls of a failed run by default, up to 20 lines, without values', () => {
    expect(codeCallPluginOptionsSchema.parse({}).trace).toEqual({ level: 'failure', maxLines: 20, values: false });
  });

  it.each([
    ['an unknown level', { level: 'verbose' }],
    ['a maxLines below 1', { maxLines: 0 }],
    ['a maxLines above 1000', { maxLines: 1001 }],
  ])('refuses %s', (_, trace) => {
    expect(() => codeCallPluginOptionsSchema.parse({ trace })).toThrow();
  });
});
