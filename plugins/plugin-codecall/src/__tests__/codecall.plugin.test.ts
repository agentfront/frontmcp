// file: plugins/plugin-codecall/src/__tests__/codecall.plugin.test.ts

import CodeCallPlugin from '../codecall.plugin';
import { CodeCallMode } from '../codecall.types';
import CodeCallConfig from '../providers/code-call.config';
import EnclaveService from '../services/enclave.service';
import { ToolSearchService } from '../services';
import { ScopeEntry } from '@frontmcp/sdk';

describe('CodeCallPlugin', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const plugin = new CodeCallPlugin();
      expect(plugin.options.mode).toBe('codecall_only');
      expect(plugin.options.topK).toBe(8);
    });

    it('should initialize with custom options', () => {
      const plugin = new CodeCallPlugin({
        mode: 'codecall_opt_in',
        topK: 15,
      });
      expect(plugin.options.mode).toBe('codecall_opt_in');
      expect(plugin.options.topK).toBe(15);
    });

    it('should log initialization message', () => {
      new CodeCallPlugin();
      expect(consoleLogSpy).toHaveBeenCalledWith('[CodeCall] Plugin initialized with mode:', 'codecall_only');
    });
  });

  describe('dynamicProviders', () => {
    it('should return array of providers', () => {
      const providers = CodeCallPlugin.dynamicProviders({});
      expect(providers).toHaveLength(3);
    });

    it('should include codecall:config provider', () => {
      const providers = CodeCallPlugin.dynamicProviders({});
      const configProvider = providers.find((p) => p.name === 'codecall:config');
      expect(configProvider).toBeDefined();
      expect(configProvider?.provide).toBe(CodeCallConfig);
      expect(configProvider?.useValue).toBeInstanceOf(CodeCallConfig);
    });

    it('should include codecall:enclave provider', () => {
      const providers = CodeCallPlugin.dynamicProviders({});
      const enclaveProvider = providers.find((p) => p.name === 'codecall:enclave');
      expect(enclaveProvider).toBeDefined();
      expect(enclaveProvider?.provide).toBe(EnclaveService);
      expect(typeof enclaveProvider?.useFactory).toBe('function');
      expect(typeof enclaveProvider?.inject).toBe('function');
    });

    it('should include codecall:tool-search provider', () => {
      const providers = CodeCallPlugin.dynamicProviders({});
      const searchProvider = providers.find((p) => p.name === 'codecall:tool-search');
      expect(searchProvider).toBeDefined();
      expect(searchProvider?.provide).toBe(ToolSearchService);
      expect(typeof searchProvider?.useFactory).toBe('function');
    });

    it('should create EnclaveService using factory', async () => {
      const providers = CodeCallPlugin.dynamicProviders({});
      const enclaveProvider = providers.find((p) => p.name === 'codecall:enclave');
      const config = new CodeCallConfig({});
      const service = await enclaveProvider?.useFactory?.(config);
      expect(service).toBeInstanceOf(EnclaveService);
    });

    it('should create ToolSearchService using factory', async () => {
      const providers = CodeCallPlugin.dynamicProviders({});
      const searchProvider = providers.find((p) => p.name === 'codecall:tool-search');
      const mockScope = {
        tools: {
          list: () => [],
          subscribe: () => () => {},
        },
      } as unknown as ScopeEntry;
      const service = await searchProvider?.useFactory?.(mockScope);
      expect(service).toBeInstanceOf(ToolSearchService);
    });

    it('should pass embedding options to ToolSearchService', async () => {
      const options = {
        embedding: {
          strategy: 'ml' as const,
          modelName: 'custom/model',
        },
        mode: 'codecall_opt_in' as const,
      };
      const providers = CodeCallPlugin.dynamicProviders(options);
      const searchProvider = providers.find((p) => p.name === 'codecall:tool-search');

      expect(searchProvider).toBeDefined();
      // The factory function should be callable
      expect(typeof searchProvider?.useFactory).toBe('function');
    });
  });

  describe('adjustListTools hook', () => {
    let plugin: CodeCallPlugin;

    const createMockFlowCtx = (tools: Array<{ tool: { name?: string; fullName?: string; metadata?: any } }>) => {
      let resolvedTools = tools;
      return {
        state: {
          resolvedTools,
          set: (key: string, value: any) => {
            if (key === 'resolvedTools') {
              resolvedTools = value;
            }
          },
        },
        get resolvedToolsAfter() {
          return resolvedTools;
        },
      } as any;
    };

    beforeEach(() => {
      plugin = new CodeCallPlugin({ mode: 'codecall_only' });
    });

    it('should return early when no tools present', async () => {
      const flowCtx = createMockFlowCtx([]);
      await plugin.adjustListTools(flowCtx);
      expect(consoleLogSpy).toHaveBeenCalledWith('[CodeCall] No tools to filter, returning early');
    });

    it('should return early when resolvedTools is undefined', async () => {
      const flowCtx = {
        state: {
          resolvedTools: undefined,
          set: jest.fn(),
        },
      } as any;
      await plugin.adjustListTools(flowCtx);
      expect(consoleLogSpy).toHaveBeenCalledWith('[CodeCall] No tools to filter, returning early');
    });

    it('should always show codecall: meta-tools in codecall_only mode', async () => {
      plugin = new CodeCallPlugin({ mode: 'codecall_only' });
      const flowCtx = createMockFlowCtx([
        { tool: { name: 'codecall:search' } },
        { tool: { name: 'codecall:describe' } },
        { tool: { name: 'other:tool' } },
      ]);

      await plugin.adjustListTools(flowCtx);

      const filtered = flowCtx.resolvedToolsAfter;
      expect(filtered).toHaveLength(2);
      expect(filtered.map((t: any) => t.tool.name)).toContain('codecall:search');
      expect(filtered.map((t: any) => t.tool.name)).toContain('codecall:describe');
    });

    it('should show tools with visibleInListTools=true in codecall_only mode', async () => {
      plugin = new CodeCallPlugin({ mode: 'codecall_only' });
      const flowCtx = createMockFlowCtx([
        { tool: { name: 'visible:tool', metadata: { codecall: { visibleInListTools: true } } } },
        { tool: { name: 'hidden:tool', metadata: { codecall: { visibleInListTools: false } } } },
        { tool: { name: 'default:tool', metadata: {} } },
      ]);

      await plugin.adjustListTools(flowCtx);

      const filtered = flowCtx.resolvedToolsAfter;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].tool.name).toBe('visible:tool');
    });

    it('should show all tools in codecall_opt_in mode', async () => {
      plugin = new CodeCallPlugin({ mode: 'codecall_opt_in' });
      const flowCtx = createMockFlowCtx([
        { tool: { name: 'tool1' } },
        { tool: { name: 'tool2' } },
        { tool: { name: 'codecall:search' } },
      ]);

      await plugin.adjustListTools(flowCtx);

      const filtered = flowCtx.resolvedToolsAfter;
      expect(filtered).toHaveLength(3);
    });

    it('should hide tools with visibleInListTools=false in metadata_driven mode', async () => {
      plugin = new CodeCallPlugin({ mode: 'metadata_driven' });
      const flowCtx = createMockFlowCtx([
        { tool: { name: 'visible:tool', metadata: { codecall: { visibleInListTools: true } } } },
        { tool: { name: 'hidden:tool', metadata: { codecall: { visibleInListTools: false } } } },
        { tool: { name: 'default:tool', metadata: {} } },
      ]);

      await plugin.adjustListTools(flowCtx);

      const filtered = flowCtx.resolvedToolsAfter;
      expect(filtered).toHaveLength(2);
      expect(filtered.map((t: any) => t.tool.name)).toContain('visible:tool');
      expect(filtered.map((t: any) => t.tool.name)).toContain('default:tool');
      expect(filtered.map((t: any) => t.tool.name)).not.toContain('hidden:tool');
    });

    it('should show tools by default in metadata_driven mode', async () => {
      plugin = new CodeCallPlugin({ mode: 'metadata_driven' });
      const flowCtx = createMockFlowCtx([
        { tool: { name: 'tool-no-metadata' } },
        { tool: { name: 'tool-empty-metadata', metadata: {} } },
        { tool: { name: 'tool-empty-codecall', metadata: { codecall: {} } } },
      ]);

      await plugin.adjustListTools(flowCtx);

      const filtered = flowCtx.resolvedToolsAfter;
      expect(filtered).toHaveLength(3);
    });

    it('should handle tools with fullName instead of name', async () => {
      plugin = new CodeCallPlugin({ mode: 'codecall_only' });
      const flowCtx = createMockFlowCtx([
        { tool: { fullName: 'codecall:execute' } },
        { tool: { fullName: 'other:tool' } },
      ]);

      await plugin.adjustListTools(flowCtx);

      const filtered = flowCtx.resolvedToolsAfter;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].tool.fullName).toBe('codecall:execute');
    });

    it('should log before and after tool counts', async () => {
      plugin = new CodeCallPlugin({ mode: 'codecall_only' });
      const flowCtx = createMockFlowCtx([{ tool: { name: 'codecall:search' } }, { tool: { name: 'other:tool' } }]);

      await plugin.adjustListTools(flowCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith('[CodeCall] Tools before filter:', 2);
      expect(consoleLogSpy).toHaveBeenCalledWith('[CodeCall] Tools after filter:', 1);
    });

    it('should handle unknown mode by showing all tools (fail-open)', async () => {
      plugin = new CodeCallPlugin({});
      // Force an unknown mode via private property
      (plugin as any).options.mode = 'unknown_mode' as CodeCallMode;

      const flowCtx = createMockFlowCtx([{ tool: { name: 'tool1' } }, { tool: { name: 'tool2' } }]);

      await plugin.adjustListTools(flowCtx);

      const filtered = flowCtx.resolvedToolsAfter;
      expect(filtered).toHaveLength(2);
    });
  });

  describe('private methods', () => {
    let plugin: CodeCallPlugin;

    beforeEach(() => {
      plugin = new CodeCallPlugin();
    });

    describe('isCodeCallTool', () => {
      it('should return true for codecall: prefixed tools', () => {
        const isCodeCall = (plugin as any).isCodeCallTool({ name: 'codecall:search' });
        expect(isCodeCall).toBe(true);
      });

      it('should return false for non-codecall tools', () => {
        const isCodeCall = (plugin as any).isCodeCallTool({ name: 'other:tool' });
        expect(isCodeCall).toBe(false);
      });

      it('should work with fullName property', () => {
        const isCodeCall = (plugin as any).isCodeCallTool({ fullName: 'codecall:describe' });
        expect(isCodeCall).toBe(true);
      });
    });

    describe('getCodeCallMetadata', () => {
      it('should extract codecall metadata', () => {
        const metadata = (plugin as any).getCodeCallMetadata({
          metadata: { codecall: { visibleInListTools: true } },
        });
        expect(metadata).toEqual({ visibleInListTools: true });
      });

      it('should return undefined when no codecall metadata', () => {
        const metadata = (plugin as any).getCodeCallMetadata({ metadata: {} });
        expect(metadata).toBeUndefined();
      });

      it('should return undefined when no metadata', () => {
        const metadata = (plugin as any).getCodeCallMetadata({});
        expect(metadata).toBeUndefined();
      });
    });

    describe('shouldShowInListTools', () => {
      it('should always show codecall tools regardless of mode', () => {
        const codecallTool = { name: 'codecall:invoke' };

        expect((plugin as any).shouldShowInListTools(codecallTool, 'codecall_only')).toBe(true);
        expect((plugin as any).shouldShowInListTools(codecallTool, 'codecall_opt_in')).toBe(true);
        expect((plugin as any).shouldShowInListTools(codecallTool, 'metadata_driven')).toBe(true);
      });

      it('should show only explicitly visible tools in codecall_only mode', () => {
        const visibleTool = { name: 'test:tool', metadata: { codecall: { visibleInListTools: true } } };
        const hiddenTool = { name: 'test:tool2', metadata: { codecall: { visibleInListTools: false } } };
        const defaultTool = { name: 'test:tool3' };

        expect((plugin as any).shouldShowInListTools(visibleTool, 'codecall_only')).toBe(true);
        expect((plugin as any).shouldShowInListTools(hiddenTool, 'codecall_only')).toBe(false);
        expect((plugin as any).shouldShowInListTools(defaultTool, 'codecall_only')).toBe(false);
      });

      it('should show all tools in codecall_opt_in mode', () => {
        const anyTool = { name: 'any:tool' };
        expect((plugin as any).shouldShowInListTools(anyTool, 'codecall_opt_in')).toBe(true);
      });

      it('should hide explicitly hidden tools in metadata_driven mode', () => {
        const hiddenTool = { name: 'test:tool', metadata: { codecall: { visibleInListTools: false } } };
        expect((plugin as any).shouldShowInListTools(hiddenTool, 'metadata_driven')).toBe(false);
      });

      it('should show tools by default in metadata_driven mode', () => {
        const defaultTool = { name: 'test:tool' };
        const undefinedVisibility = { name: 'test:tool2', metadata: { codecall: {} } };

        expect((plugin as any).shouldShowInListTools(defaultTool, 'metadata_driven')).toBe(true);
        expect((plugin as any).shouldShowInListTools(undefinedVisibility, 'metadata_driven')).toBe(true);
      });
    });
  });
});
