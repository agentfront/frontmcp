/**
 * @file platform-meta.test.ts
 * @description Tests for platform metadata adapters, including MCP Apps (ext-apps).
 */

import { buildUIMeta, buildToolDiscoveryMeta, type AIPlatformType, type UITemplateConfig } from '../platform-meta';

describe('Platform Metadata Adapters', () => {
  const baseUIConfig: UITemplateConfig = {
    template: () => '<div>Test</div>',
  };

  const resourceUri = 'ui://tools/test_tool/result/abc123';
  const html = '<div>Test HTML</div>';

  describe('buildUIMeta - ext-apps platform', () => {
    it('should generate ext-apps metadata with resourceUri', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        resourceUri,
        html,
      });

      expect(meta['ui/resourceUri']).toBe(resourceUri);
      expect(meta['ui/mimeType']).toBe('text/html+mcp');
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
        resourceUri,
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
        resourceUri,
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
        resourceUri,
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
        resourceUri,
        html,
      });

      expect(meta['ui/domain']).toBe('sandbox.example.com');
    });

    it('should always include inline HTML', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        resourceUri,
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

  describe('buildUIMeta - universal fields', () => {
    it('should always include ui/html', () => {
      const platforms: AIPlatformType[] = ['openai', 'claude', 'gemini', 'ext-apps', 'generic-mcp', 'unknown'];

      for (const platformType of platforms) {
        const meta = buildUIMeta({
          uiConfig: baseUIConfig,
          platformType,
          resourceUri,
          html,
        });

        expect(meta['ui/html']).toBe(html);
      }
    });

    it('should include widget token when provided', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        resourceUri,
        html,
        token: 'test-token-123',
      });

      expect(meta['ui/widgetToken']).toBe('test-token-123');
    });

    it('should include direct URL when provided', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        resourceUri,
        html,
        directUrl: 'https://mcp-server.example.com/widgets/test?token=123',
      });

      expect(meta['ui/directUrl']).toBe('https://mcp-server.example.com/widgets/test?token=123');
    });
  });

  describe('MIME type per platform', () => {
    it('should use text/html+skybridge for OpenAI', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'openai',
        resourceUri,
        html,
      });

      expect(meta['ui/mimeType']).toBe('text/html+skybridge');
    });

    it('should use text/html+mcp for ext-apps', () => {
      const meta = buildUIMeta({
        uiConfig: baseUIConfig,
        platformType: 'ext-apps',
        resourceUri,
        html,
      });

      expect(meta['ui/mimeType']).toBe('text/html+mcp');
    });

    it('should use text/html+mcp for other platforms', () => {
      const platforms: AIPlatformType[] = ['claude', 'gemini', 'cursor', 'continue', 'cody', 'generic-mcp'];

      for (const platformType of platforms) {
        const meta = buildUIMeta({
          uiConfig: baseUIConfig,
          platformType,
          resourceUri,
          html,
        });

        expect(meta['ui/mimeType']).toBe('text/html+mcp');
      }
    });
  });
});
