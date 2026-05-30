/**
 * IIFE Generator Tests
 */

import { BRIDGE_SCRIPT_TAGS, generateBridgeIIFE, generatePlatformBundle, UNIVERSAL_BRIDGE_SCRIPT } from '../runtime';

describe('IIFE Generator', () => {
  describe('generateBridgeIIFE', () => {
    it('should generate valid JavaScript IIFE', () => {
      const script = generateBridgeIIFE();

      expect(script).toContain('(function()');
      expect(script).toContain('"use strict"');
      expect(script).toContain('})();');
    });

    it('should include all adapters by default', () => {
      const script = generateBridgeIIFE();

      expect(script).toContain('OpenAIAdapter');
      expect(script).toContain('ExtAppsAdapter');
      expect(script).toContain('ClaudeAdapter');
      expect(script).toContain('GeminiAdapter');
      expect(script).toContain('GenericAdapter');
    });

    it('should include only specified adapters', () => {
      const script = generateBridgeIIFE({ adapters: ['openai', 'generic'] });

      expect(script).toContain('OpenAIAdapter');
      expect(script).toContain('GenericAdapter');
      expect(script).not.toContain('ClaudeAdapter');
      expect(script).not.toContain('GeminiAdapter');
      expect(script).not.toContain('ExtAppsAdapter');
    });

    it('should include debug logging when enabled', () => {
      const debugScript = generateBridgeIIFE({ debug: true });
      const normalScript = generateBridgeIIFE({ debug: false });

      expect(debugScript).toContain('console.log("[FrontMcpBridge]');
      expect(normalScript).toContain('function log() {}');
    });

    it('should include trusted origins for ext-apps', () => {
      const script = generateBridgeIIFE({
        adapters: ['ext-apps', 'generic'],
        trustedOrigins: ['https://example.com', 'https://other.com'],
      });

      expect(script).toContain('https://example.com');
      expect(script).toContain('https://other.com');
    });

    it('should generate FrontMcpBridge class', () => {
      const script = generateBridgeIIFE();

      expect(script).toContain('function FrontMcpBridge()');
      expect(script).toContain('FrontMcpBridge.prototype.initialize');
      expect(script).toContain('FrontMcpBridge.prototype.getTheme');
      expect(script).toContain('FrontMcpBridge.prototype.getToolInput');
    });

    it('should expose global FrontMcpBridge', () => {
      const script = generateBridgeIIFE();

      expect(script).toContain('window.FrontMcpBridge = bridge');
    });

    it('should dispatch bridge:ready event', () => {
      const script = generateBridgeIIFE();

      expect(script).toContain('bridge:ready');
      expect(script).toContain('CustomEvent');
    });

    it('should include platform detection', () => {
      const script = generateBridgeIIFE();

      expect(script).toContain('detectPlatform');
      expect(script).toContain('ADAPTERS');
    });

    it('should support minification', () => {
      const normal = generateBridgeIIFE({ minify: false });
      const minified = generateBridgeIIFE({ minify: true });

      expect(minified.length).toBeLessThan(normal.length);
      // Minified should still contain key elements
      expect(minified).toContain('FrontMcpBridge');
    });
  });

  describe('generatePlatformBundle', () => {
    it('should generate ChatGPT bundle with OpenAI adapter', () => {
      const script = generatePlatformBundle('chatgpt');

      expect(script).toContain('OpenAIAdapter');
      expect(script).toContain('GenericAdapter');
      expect(script).not.toContain('ClaudeAdapter');
    });

    it('should generate Claude bundle with Claude adapter', () => {
      const script = generatePlatformBundle('claude');

      expect(script).toContain('ClaudeAdapter');
      expect(script).toContain('GenericAdapter');
      expect(script).not.toContain('OpenAIAdapter');
    });

    it('should generate Gemini bundle with Gemini adapter', () => {
      const script = generatePlatformBundle('gemini');

      expect(script).toContain('GeminiAdapter');
      expect(script).toContain('GenericAdapter');
      expect(script).not.toContain('OpenAIAdapter');
    });

    it('should generate universal bundle with all adapters', () => {
      const script = generatePlatformBundle('universal');

      expect(script).toContain('OpenAIAdapter');
      expect(script).toContain('ExtAppsAdapter');
      expect(script).toContain('ClaudeAdapter');
      expect(script).toContain('GeminiAdapter');
      expect(script).toContain('GenericAdapter');
    });
  });

  describe('Pre-generated constants', () => {
    it('should export UNIVERSAL_BRIDGE_SCRIPT', () => {
      expect(UNIVERSAL_BRIDGE_SCRIPT).toBeDefined();
      expect(UNIVERSAL_BRIDGE_SCRIPT).toContain('FrontMcpBridge');
    });

    it('should export BRIDGE_SCRIPT_TAGS with script tags', () => {
      expect(BRIDGE_SCRIPT_TAGS.universal).toContain('<script>');
      expect(BRIDGE_SCRIPT_TAGS.universal).toContain('</script>');
      expect(BRIDGE_SCRIPT_TAGS.chatgpt).toContain('<script>');
      expect(BRIDGE_SCRIPT_TAGS.claude).toContain('<script>');
      expect(BRIDGE_SCRIPT_TAGS.gemini).toContain('<script>');
    });
  });

  describe('Generated code features', () => {
    const script = generateBridgeIIFE();

    it('should detect OpenAI environment', () => {
      expect(script).toContain('window.openai');
      // OpenAI detection uses the existence of window.openai.callTool function
      expect(script).toContain('window.openai.callTool');
    });

    it('should detect Claude environment', () => {
      expect(script).toContain("__mcpPlatform === 'claude'");
      expect(script).toContain('claude.ai');
    });

    it('should detect Gemini environment', () => {
      expect(script).toContain("__mcpPlatform === 'gemini'");
      expect(script).toContain('gemini.google.com');
    });

    it('should detect ext-apps environment', () => {
      // ext-apps checks for iframe context
      expect(script).toContain('window.parent');
    });

    it('should exclude Claude from ext-apps detection', () => {
      // ext-apps adapter should not match Claude contexts
      expect(script).toContain("window.__mcpPlatform === 'claude'");
      expect(script).toContain('window.__claudeArtifact');
      expect(script).toContain('window.claude');
      // URL hostname validation using proper URL parsing
      expect(script).toContain('new URL(location.href)');
      expect(script).toContain('hostname.toLowerCase()');
      expect(script).toContain("hostname === 'claude.ai'");
      expect(script).toContain("hostname === 'anthropic.com'");
    });

    it('should require explicit ext-apps marker instead of defaulting to true', () => {
      // ext-apps should not default to true for any iframe
      // It should check for __extAppsInitialized
      expect(script).toContain('window.__extAppsInitialized');
    });

    it('should include theme detection', () => {
      expect(script).toContain('detectTheme');
      expect(script).toContain('prefers-color-scheme');
    });

    it('should include locale detection', () => {
      expect(script).toContain('detectLocale');
      expect(script).toContain('navigator.language');
    });

    it('should include user agent detection', () => {
      expect(script).toContain('detectUserAgent');
      expect(script).toContain('iPhone|iPad|iPod|Android');
    });

    it('should include viewport detection', () => {
      expect(script).toContain('detectViewport');
      expect(script).toContain('innerWidth');
      expect(script).toContain('innerHeight');
    });

    it('should read injected tool data', () => {
      expect(script).toContain('__mcpToolInput');
      expect(script).toContain('__mcpToolOutput');
      expect(script).toContain('__mcpStructuredContent');
    });

    it('should support localStorage for widget state', () => {
      expect(script).toContain('localStorage');
      expect(script).toContain('frontmcp:widget');
    });
  });

  describe('auto-resize routine', () => {
    it('should include the auto-resize initializer', () => {
      const script = generateBridgeIIFE();
      expect(script).toContain('__initAutoResize');
      expect(script).toContain('__applySizingCss');
    });

    it('should read the injected __mcpWidgetSizing global', () => {
      const script = generateBridgeIIFE();
      expect(script).toContain('window.__mcpWidgetSizing');
    });

    it('should feature-detect ResizeObserver before observing', () => {
      const script = generateBridgeIIFE();
      expect(script).toContain("typeof ResizeObserver === 'undefined'");
      expect(script).toContain('new ResizeObserver');
    });

    it('should respect autoResize:false (opt-out short-circuit)', () => {
      const script = generateBridgeIIFE();
      expect(script).toContain('sizing.autoResize === false');
    });

    it('should expose a bridge setSize API and report through it', () => {
      const script = generateBridgeIIFE();
      expect(script).toContain('FrontMcpBridge.prototype.setSize');
      expect(script).toContain('window.FrontMcpBridge.setSize');
    });

    it('should emit ui/setSize from the ext-apps adapter', () => {
      const script = generateBridgeIIFE({ adapters: ['ext-apps', 'generic'] });
      expect(script).toContain('setSize:');
      expect(script).toContain("'ui/setSize'");
    });

    it('is present even when only the generic adapter is selected', () => {
      const script = generateBridgeIIFE({ adapters: ['generic'] });
      expect(script).toContain('__initAutoResize');
    });
  });
});
