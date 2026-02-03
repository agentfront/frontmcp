// file: libs/plugins/src/codecall/providers/code-call.config.ts

import { Provider, ProviderScope, BaseConfig } from '@frontmcp/sdk';
import {
  CodeCallPluginOptions,
  CodeCallVmOptions,
  CodeCallVmPreset,
  codeCallPluginOptionsSchema,
} from '../codecall.types';
import { ResolvedCodeCallVmOptions } from '../codecall.symbol';

/**
 * CodeCall configuration provider with convict-like API
 * Extends BaseConfig to provide type-safe dotted path access
 *
 * @example
 * // Get values with dotted path notation
 * config.get('vm.preset') // returns 'secure'
 * config.get('embedding.strategy') // returns 'tfidf'
 * config.get('directCalls.enabled') // returns true
 *
 * // Get with default value
 * config.get('vm.timeoutMs', 5000) // returns value or 5000
 *
 * // Get entire sections
 * config.getSection('vm') // returns entire vm config
 * config.getAll() // returns complete config
 *
 * // Require values (throws if undefined)
 * config.getOrThrow('mode') // throws if undefined
 * config.getRequired('topK') // same as getOrThrow
 */
@Provider({
  name: 'codecall:config',
  description: 'CodeCall plugin configuration with validated defaults',
  scope: ProviderScope.GLOBAL,
})
export default class CodeCallConfig extends BaseConfig<
  CodeCallPluginOptions & { resolvedVm: ResolvedCodeCallVmOptions }
> {
  constructor(options: Partial<CodeCallPluginOptions> = {}) {
    // Parse and validate options with Zod schema to apply all defaults
    const parsedConfig = codeCallPluginOptionsSchema.parse(options);

    // Resolve VM options with preset defaults
    const resolvedVm = resolveVmOptions(parsedConfig.vm);

    super({ ...parsedConfig, resolvedVm });
  }
}

// ---- VM Options Resolution ----

function resolveVmOptions(vmOptions?: CodeCallVmOptions): ResolvedCodeCallVmOptions {
  const preset: CodeCallVmPreset = vmOptions?.preset ?? 'secure';

  const base = presetDefaults(preset);

  return {
    ...base,
    ...vmOptions,
    disabledBuiltins: vmOptions?.disabledBuiltins ?? base.disabledBuiltins,
    disabledGlobals: vmOptions?.disabledGlobals ?? base.disabledGlobals,
  };
}

function presetDefaults(preset: CodeCallVmPreset): ResolvedCodeCallVmOptions {
  switch (preset) {
    case 'locked_down':
      return {
        preset,
        timeoutMs: 2000,
        allowLoops: false,
        allowConsole: false,
        maxSteps: 2000,
        disabledBuiltins: ['eval', 'Function', 'AsyncFunction'],
        disabledGlobals: [
          'require',
          'process',
          'fetch',
          'setTimeout',
          'setInterval',
          'setImmediate',
          'global',
          'globalThis',
        ],
        maxSanitizeDepth: 10,
        maxSanitizeProperties: 1000,
      };

    case 'balanced':
      return {
        preset,
        timeoutMs: 5000,
        allowLoops: true,
        allowConsole: true,
        maxSteps: 10000,
        disabledBuiltins: ['eval', 'Function', 'AsyncFunction'],
        disabledGlobals: ['require', 'process', 'fetch'],
        maxSanitizeDepth: 50,
        maxSanitizeProperties: 5000,
      };

    case 'experimental':
      return {
        preset,
        timeoutMs: 10000,
        allowLoops: true,
        allowConsole: true,
        maxSteps: 20000,
        disabledBuiltins: ['eval', 'Function', 'AsyncFunction'],
        disabledGlobals: ['require', 'process'],
        maxSanitizeDepth: 100,
        maxSanitizeProperties: 20000,
      };

    case 'secure':
    default:
      return {
        preset: 'secure',
        timeoutMs: 3500,
        allowLoops: false,
        allowConsole: true,
        maxSteps: 5000,
        disabledBuiltins: ['eval', 'Function', 'AsyncFunction'],
        disabledGlobals: [
          'require',
          'process',
          'fetch',
          'setTimeout',
          'setInterval',
          'setImmediate',
          'global',
          'globalThis',
        ],
        maxSanitizeDepth: 50,
        maxSanitizeProperties: 2000,
      };
  }
}
