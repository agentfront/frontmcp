/**
 * @file platform-meta.test.ts
 * @description Tests for platform metadata adapters, including MCP Apps (ext-apps).
 *
 * Note: buildUIMeta is used for inline mode (HTML embedded in _meta).
 * For static mode, tools/list provides the static widget URI via buildToolDiscoveryMeta.
 */

import { buildUIMeta, buildToolDiscoveryMeta, type AIPlatformType, type UITemplateConfig } from '../platform-meta';

describe('Platform Metadata Adapters', () => {
  const baseUIConfig: UITemplateConfig = {
    template: () => '<div>Test</div>',
  };

  const html = '<div>Test HTML</div>';

  describe('buildUIMeta - ext-apps platform (inline mode)', () => {
    it('should generate ext-apps metadata with mimeType', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        html,
      });

      expect(meta['ui/mimeType']).toBe('text/html+mcp');
      // Inline mode embeds HTML directly, no resourceUri needed
      expect(meta['ui/html']).toBe(html);
    });

    it('should include CSP configuration', () => {
      const meta = buildUIMeta({
        uiConfig: {
          ...baseUIConfig,
          csp: {
            connectDomains: ['https://api.example.com'],
            resourceDomains: ['https://cdn.example.com'],
          },
        },
        platformType: 'ext-apps',
        html,
      });

      expect(meta['ui/csp']).toEqual({
        connectDomains: ['https://api.example.com'],
        resourceDomains: ['https://cdn.example.com'],
      });
    });

    it('should include display mode', () => {
      const meta = buildUIMeta({
        uiConfig: {
          ...baseUIConfig,
          displayMode: 'fullscreen',
        },
        platformType: 'ext-apps',
        html,
      });

      expect(meta['ui/displayMode']).toBe('fullscreen');
    });

    it('should include prefersBorder', () => {
      const meta = buildUIMeta({
        uiConfig: {
          ...baseUIConfig,
          prefersBorder: true,
        },
        platformType: 'ext-apps',
        html,
      });

      expect(meta['ui/prefersBorder']).toBe(true);
    });

    it('should include sandbox domain', () => {
      const meta = buildUIMeta({
        uiConfig: {
          ...baseUIConfig,
          sandboxDomain: 'sandbox.example.com',
        },
        platformType: 'ext-apps',
        html,
      });

      expect(meta['ui/domain']).toBe('sandbox.example.com');
    });

    it('should always include inline HTML', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        html,
      });

      expect(meta['ui/html']).toBe(html);
    });
  });

  describe('buildToolDiscoveryMeta - ext-apps platform', () => {
    const staticWidgetUri = 'ui://widget/test_tool.html';

    it('should generate discovery metadata with resourceUri', () => {
      const meta = buildToolDiscoveryMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        staticWidgetUri,
      });

      expect(meta['ui/resourceUri']).toBe(staticWidgetUri);
      expect(meta['ui/mimeType']).toBe('text/html+mcp');
    });

    it('should include CSP in discovery metadata', () => {
      const meta = buildToolDiscoveryMeta({
        uiConfig: {
          ...baseUIConfig,
          csp: {
            connectDomains: ['https://api.example.com'],
          },
        },
        platformType: 'ext-apps',
        staticWidgetUri,
      });

      expect(meta['ui/csp']).toEqual({
        connectDomains: ['https://api.example.com'],
      });
    });

    it('should include displayMode in discovery metadata', () => {
      const meta = buildToolDiscoveryMeta({
        uiConfig: {
          ...baseUIConfig,
          displayMode: 'pip',
        },
        platformType: 'ext-apps',
        staticWidgetUri,
      });

      expect(meta['ui/displayMode']).toBe('pip');
    });

    it('should include prefersBorder in discovery metadata', () => {
      const meta = buildToolDiscoveryMeta({
        uiConfig: {
          ...baseUIConfig,
          prefersBorder: false,
        },
        platformType: 'ext-apps',
        staticWidgetUri,
      });

      expect(meta['ui/prefersBorder']).toBe(false);
    });

    it('should include sandbox domain in discovery metadata', () => {
      const meta = buildToolDiscoveryMeta({
        uiConfig: {
          ...baseUIConfig,
          sandboxDomain: 'sandbox.example.com',
        },
        platformType: 'ext-apps',
        staticWidgetUri,
      });

      expect(meta['ui/domain']).toBe('sandbox.example.com');
    });
  });

  describe('AIPlatformType includes ext-apps', () => {
    it('should allow ext-apps as valid platform type', () => {
      const platformType: AIPlatformType = 'ext-apps';
      expect(platformType).toBe('ext-apps');
    });
  });

  describe('buildUIMeta - HTML content per platform (inline mode)', () => {
    it('should include HTML in platform-specific namespace', () => {
      // OpenAI uses openai/* namespace
      const openaiMeta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'openai',
        html,
      });
      expect(openaiMeta['openai/html']).toBe(html);
      expect(openaiMeta['ui/html']).toBeUndefined();

      // ext-apps uses ui/* namespace
      const extAppsMeta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        html,
      });
      expect(extAppsMeta['ui/html']).toBe(html);
      expect(extAppsMeta['openai/html']).toBeUndefined();

      // Other platforms use frontmcp/* + ui/* for compatibility
      const claudeMeta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'claude',
        html,
      });
      expect(claudeMeta['frontmcp/html']).toBe(html);
      expect(claudeMeta['ui/html']).toBe(html); // compatibility
      expect(claudeMeta['openai/html']).toBeUndefined();
    });

    it('should include widget token in platform-specific namespace', () => {
      // ext-apps
      const extAppsMeta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        html,
        token: 'test-token-123',
      });
      expect(extAppsMeta['ui/widgetToken']).toBe('test-token-123');

      // OpenAI
      const openaiMeta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'openai',
        html,
        token: 'test-token-456',
      });
      expect(openaiMeta['openai/widgetToken']).toBe('test-token-456');

      // Other platforms
      const claudeMeta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'claude',
        html,
        token: 'test-token-789',
      });
      expect(claudeMeta['frontmcp/widgetToken']).toBe('test-token-789');
    });

    it('should include direct URL in platform-specific namespace', () => {
      const directUrl = 'https://mcp-server.example.com/widgets/test?token=123';

      // ext-apps
      const extAppsMeta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        html,
        directUrl,
      });
      expect(extAppsMeta['ui/directUrl']).toBe(directUrl);

      // OpenAI
      const openaiMeta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'openai',
        html,
        directUrl,
      });
      expect(openaiMeta['openai/directUrl']).toBe(directUrl);

      // Other platforms
      const claudeMeta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'claude',
        html,
        directUrl,
      });
      expect(claudeMeta['frontmcp/directUrl']).toBe(directUrl);
    });
  });

  describe('MIME type per platform', () => {
    it('should use openai/* namespace with text/html+skybridge for OpenAI', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'openai',
        html,
      });

      // OpenAI uses openai/* namespace only
      expect(meta['openai/mimeType']).toBe('text/html+skybridge');
      expect(meta['openai/html']).toBe(html);
      // Should NOT have ui/* keys
      expect(meta['ui/mimeType']).toBeUndefined();
    });

    it('should use ui/* namespace with text/html+mcp for ext-apps', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        html,
      });

      // ext-apps uses ui/* namespace per SEP-1865
      expect(meta['ui/mimeType']).toBe('text/html+mcp');
      expect(meta['ui/html']).toBe(html);
      // Should NOT have openai/* or frontmcp/* keys
      expect(meta['openai/mimeType']).toBeUndefined();
      expect(meta['frontmcp/mimeType']).toBeUndefined();
    });

    it('should use frontmcp/* and ui/* namespaces with text/html+mcp for other platforms', () => {
      const platforms: AIPlatformType[] = ['claude', 'gemini', 'cursor', 'continue', 'cody', 'generic-mcp'];

      for (const platformType of platforms) {
        const meta = buildUIMeta({
          uiConfig: baseUIConfig,
          platformType,
          html,
        });

        // Other platforms use frontmcp/* namespace + ui/* for compatibility
        expect(meta['frontmcp/mimeType']).toBe('text/html+mcp');
        expect(meta['frontmcp/html']).toBe(html);
        expect(meta['ui/mimeType']).toBe('text/html+mcp');
        expect(meta['ui/html']).toBe(html);
        // Should NOT have openai/* keys
        expect(meta['openai/mimeType']).toBeUndefined();
      }
    });
  });
});
