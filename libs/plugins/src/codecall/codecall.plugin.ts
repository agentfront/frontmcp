// file: libs/plugins/src/codecall/codecall.plugin.ts

import { DynamicPlugin, FlowCtxOf, ListToolsHook, Plugin, ProviderType, ScopeEntry, ToolEntry } from '@frontmcp/sdk';

import {
  CodeCallMode,
  CodeCallPluginOptions,
  CodeCallPluginOptionsInput,
  CodeCallToolMetadata,
  codeCallPluginOptionsSchema,
} from './codecall.types';
import { ToolSearchService } from './services/tool-search.service';

import SearchTool from './tools/search.tool';
import DescribeTool from './tools/describe.tool';
import ExecuteTool from './tools/execute.tool';
import InvokeTool from './tools/invoke.tool';

import CodeCallConfig from './providers/code-call.config';
import EnclaveService from './services/enclave.service';
import CachePlugin from '../cache';

@Plugin({
  name: 'codecall',
  description: 'CodeCall plugin: AgentScript-based meta-tools for orchestrating MCP tools',
  providers: [],
  plugins: [CachePlugin],
  tools: [SearchTool, DescribeTool, ExecuteTool, InvokeTool],
})
export default class CodeCallPlugin extends DynamicPlugin<CodeCallPluginOptions, CodeCallPluginOptionsInput> {
  options: CodeCallPluginOptions;

  constructor(options: CodeCallPluginOptionsInput = {}) {
    super();
    // Parse options with Zod schema to apply all defaults
    this.options = codeCallPluginOptionsSchema.parse(options);
  }

  /**
   * Dynamic providers allow you to configure the plugin with custom options
   * without touching the plugin decorator.
   */
  static override dynamicProviders(options: CodeCallPluginOptionsInput): ProviderType[] {
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
   * Hook into list_tools to enforce CodeCall modes:
   *
   * Modes:
   * - codecall_only: Hide all tools from list_tools except CodeCall meta-tools.
   *                  All other tools must be discovered via codecall:search.
   * - codecall_opt_in: Show all tools in list_tools. Tools opt-in to CodeCall via metadata.
   * - metadata_driven: Use per-tool metadata.codecall to control visibility in list_tools.
   *
   * CodeCall meta-tools (codecall:search, codecall:describe, codecall:execute, codecall:invoke)
   * are ALWAYS visible regardless of mode.
   */
  @ListToolsHook.Did('resolveConflicts', { priority: 1000 })
  async adjustListTools(flowCtx: FlowCtxOf<'tools:list-tools'>) {
    const { resolvedTools } = flowCtx.state;

    if (!resolvedTools || resolvedTools.length === 0) {
      return;
    }

    // Filter tools based on mode
    const filteredTools = resolvedTools.filter(({ tool }) => {
      return this.shouldShowInListTools(tool, this.options.mode);
    });

    // Update the state with filtered tools
    flowCtx.state.set('resolvedTools', filteredTools);
  }

  /**
   * Determine if a tool should be visible in list_tools based on mode.
   *
   * @param tool - The tool entry to check
   * @param mode - The current CodeCall mode
   * @returns true if tool should be visible
   */
  private shouldShowInListTools(tool: ToolEntry<any, any, any, any>, mode: CodeCallMode): boolean {
    // CodeCall meta-tools are ALWAYS visible
    if (this.isCodeCallTool(tool)) {
      return true;
    }

    // Get tool's CodeCall metadata
    const codecallMeta = this.getCodeCallMetadata(tool);

    switch (mode) {
      case 'codecall_only':
        // In codecall_only mode, only CodeCall meta-tools and tools with
        // explicit visibleInListTools=true are shown
        return codecallMeta?.visibleInListTools === true;

      case 'codecall_opt_in':
        // In opt_in mode, all tools are shown (they opt-in to CodeCall execution via metadata)
        return true;

      case 'metadata_driven':
        // In metadata_driven mode, use per-tool metadata
        // Default: show unless explicitly hidden
        if (codecallMeta?.visibleInListTools === false) {
          return false;
        }
        // If visibleInListTools is true or undefined, show the tool
        return true;

      default:
        // Unknown mode - default to showing the tool (fail-open for UX)
        return true;
    }
  }

  /**
   * Check if a tool is a CodeCall meta-tool.
   * CodeCall meta-tools always remain visible.
   */
  private isCodeCallTool(tool: ToolEntry<any, any, any, any>): boolean {
    const name = tool.name || tool.fullName;
    return name.startsWith('codecall:');
  }

  /**
   * Extract CodeCall-specific metadata from a tool.
   */
  private getCodeCallMetadata(tool: ToolEntry<any, any, any, any>): CodeCallToolMetadata | undefined {
    return (tool.metadata as any)?.codecall as CodeCallToolMetadata | undefined;
  }
}
