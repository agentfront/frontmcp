// file: libs/plugins/src/codecall/codecall.plugin.ts

import { DynamicPlugin, FlowCtxOf, ListToolsHook, Plugin, ProviderType, ScopeEntry } from '@frontmcp/sdk';

import { CodeCallPluginOptions, CodeCallVmOptions, CodeCallVmPreset } from './codecall.types';
import { CodeCallConfig, ResolvedCodeCallVmOptions } from './codecall.symbol';
import { ToolSearchService } from './services/tool-search.service';

import SearchTool from './tools/search.tool';
import DescribeTool from './tools/describe.tool';
import ExecuteTool from './tools/execute.tool';
import InvokeTool from './tools/invoke.tool';

import CodeCallAstValidator from './providers/codecall-ast-validator.provider';
import CodeCallVm2Runner from './providers/codecall-vm2.provider';

@Plugin({
  name: 'codecall',
  description: 'CodeCall plugin: VM-based meta-tools for orchestrating MCP tools',
  providers: [CodeCallAstValidator, CodeCallVm2Runner],
  tools: [SearchTool, DescribeTool, ExecuteTool, InvokeTool],
})
export default class CodeCallPlugin extends DynamicPlugin<CodeCallPluginOptions> {
  static defaultOptions: CodeCallPluginOptions = {
    mode: 'codecall_only',
    topK: 8,
    maxDefinitions: 8,
    vm: {
      preset: 'secure',
    },
  };

  options: CodeCallPluginOptions;

  constructor(options: CodeCallPluginOptions = CodeCallPlugin.defaultOptions) {
    super();
    this.options = {
      ...CodeCallPlugin.defaultOptions,
      ...options,
      vm: {
        ...CodeCallPlugin.defaultOptions.vm,
        ...(options.vm ?? {}),
      },
    };
  }

  /**
   * Dynamic providers allow you to override the VM implementation in the future
   * (e.g. different presets, or a non-vm2 engine) without touching the plugin decorator.
   */
  static override dynamicProviders(options: CodeCallPluginOptions): ProviderType[] {
    return [
      {
        name: 'codecall:config',
        provide: CodeCallConfig,
        useValue: options,
      },
      {
        name: 'codecall:tool-search',
        provide: ToolSearchService,
        inject: () => [ScopeEntry],
        useFactory: async (scope: ScopeEntry) => {
          return new ToolSearchService(
            {
              embeddingOptions: options.embedding,
            },
            scope,
          );
        },
      },
    ];
  }

  /**
   * Hook into list_tools to eventually enforce CodeCall modes:
   *   - which tools appear in list_tools
   *   - which are only callable via CodeCall
   *
   * For now this method is a no-op so you can layer in behavior incrementally.
   */
  @ListToolsHook.Did('resolveConflicts', { priority: 1000 })
  async adjustListTools(flowCtx: FlowCtxOf<'tools:list-tools'>) {
    // TODO:
    // - read final tool list from flowCtx.state / flowCtx.result
    // - apply this.options.mode + per-tool metadata (metadata.codecall)
    // - hide/show tools + ensure CodeCall meta-tools stay visible
  }
}

// ---- helpers ----

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
      };
  }
}
