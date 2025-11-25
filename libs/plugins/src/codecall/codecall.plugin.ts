// file: libs/plugins/src/codecall/codecall.plugin.ts

import { DynamicPlugin, FlowCtxOf, ListToolsHook, Plugin, ProviderType, ScopeEntry } from '@frontmcp/sdk';

import { CodeCallPluginOptions, codeCallPluginOptionsSchema } from './codecall.types';
import { ToolSearchService } from './services/tool-search.service';

import SearchTool from './tools/search.tool';
import DescribeTool from './tools/describe.tool';
import ExecuteTool from './tools/execute.tool';
import InvokeTool from './tools/invoke.tool';

import CodeCallConfig from './providers/code-call.config';
import EnclaveService from './services/enclave.service';

@Plugin({
  name: 'codecall',
  description: 'CodeCall plugin: AgentScript-based meta-tools for orchestrating MCP tools',
  providers: [],
  tools: [SearchTool, DescribeTool, ExecuteTool, InvokeTool],
})
export default class CodeCallPlugin extends DynamicPlugin<CodeCallPluginOptions> {
  options: CodeCallPluginOptions;

  constructor(options: Partial<CodeCallPluginOptions> = {}) {
    super();
    // Parse options with Zod schema to apply all defaults
    this.options = codeCallPluginOptionsSchema.parse(options);
  }

  /**
   * Dynamic providers allow you to configure the plugin with custom options
   * without touching the plugin decorator.
   */
  static override dynamicProviders(options: Partial<CodeCallPluginOptions>): ProviderType[] {
    // Parse options with Zod schema to apply all defaults
    const parsedOptions = codeCallPluginOptionsSchema.parse(options);

    // Create config instance
    const config = new CodeCallConfig(parsedOptions);

    return [
      {
        name: 'codecall:config',
        provide: CodeCallConfig,
        useValue: config,
      },
      {
        name: 'codecall:enclave',
        provide: EnclaveService,
        inject: () => [CodeCallConfig],
        useFactory: async (cfg: CodeCallConfig) => {
          return new EnclaveService(cfg);
        },
      },
      {
        name: 'codecall:tool-search',
        provide: ToolSearchService,
        inject: () => [ScopeEntry],
        useFactory: async (scope: ScopeEntry) => {
          return new ToolSearchService(
            {
              embeddingOptions: parsedOptions.embedding,
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
