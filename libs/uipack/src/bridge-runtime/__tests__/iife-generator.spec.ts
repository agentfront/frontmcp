import { generateBridgeIIFE } from '../iife-generator';

describe('generateBridgeIIFE', () => {
  it('should generate valid JavaScript IIFE', () => {
    const result = generateBridgeIIFE();
    expect(result).toMatch(/^\(function\(\)\s*\{/);
    expect(result).toMatch(/\}\)\(\);?$/);
  });

  it('should include all default adapters', () => {
    const result = generateBridgeIIFE();
    expect(result).toContain('OpenAIAdapter');
    expect(result).toContain('ExtAppsAdapter');
    expect(result).toContain('ClaudeAdapter');
    expect(result).toContain('GeminiAdapter');
    expect(result).toContain('GenericAdapter');
  });

  it('should include only specified adapters', () => {
    const result = generateBridgeIIFE({ adapters: ['generic'] });
    expect(result).toContain('GenericAdapter');
    expect(result).not.toContain('OpenAIAdapter');
    expect(result).not.toContain('ExtAppsAdapter');
  });

  it('should include FrontMcpBridge class', () => {
    const result = generateBridgeIIFE();
    expect(result).toContain('function FrontMcpBridge()');
    expect(result).toContain('window.FrontMcpBridge');
  });

  describe('ext-apps adapter', () => {
    it('should send handshake with wildcard origin for initial message', () => {
      const result = generateBridgeIIFE({ adapters: ['ext-apps', 'generic'] });
      // sendHandshake posts ui/initialize with '*' target origin
      expect(result).toContain("'ui/initialize'");
      expect(result).toContain("'*'");
    });

    it('should set up message listener before handshake', () => {
      const result = generateBridgeIIFE({ adapters: ['ext-apps', 'generic'] });
      const listenerIdx = result.indexOf("addEventListener('message'");
      const handshakeIdx = result.indexOf('sendHandshake(context)');
      expect(listenerIdx).toBeGreaterThan(-1);
      expect(handshakeIdx).toBeGreaterThan(-1);
      expect(listenerIdx).toBeLessThan(handshakeIdx);
    });

    it('should check __mcpAppsEnabled in canHandle', () => {
      const result = generateBridgeIIFE({ adapters: ['ext-apps', 'generic'] });
      expect(result).toContain('__mcpAppsEnabled');
    });

    it('should emit the standard size-changed notification from the ext-apps setSize method', () => {
      const result = generateBridgeIIFE({ adapters: ['ext-apps', 'generic'] });
      expect(result).toContain('setSize:');
      expect(result).toContain("'ui/notifications/size-changed'");
      expect(result).not.toContain('ui/setSize');
    });
  });

  describe('auto-resize routine', () => {
    it('should include the auto-resize initializer', () => {
      const result = generateBridgeIIFE();
      expect(result).toContain('__initAutoResize');
      expect(result).toContain('__applySizingCss');
    });

    it('should read the injected __mcpWidgetSizing global', () => {
      const result = generateBridgeIIFE();
      expect(result).toContain('window.__mcpWidgetSizing');
    });

    it('should feature-detect ResizeObserver before observing', () => {
      const result = generateBridgeIIFE();
      expect(result).toContain("typeof ResizeObserver === 'undefined'");
      expect(result).toContain('new ResizeObserver');
      expect(result).toContain('ro.observe(targets[i])');
    });

    it('should measure the whole document (<html> at fit-content), not #root', () => {
      const result = generateBridgeIIFE();
      expect(result).toContain('function __measureHeight()');
      expect(result).toContain("de.style.height = 'fit-content'");
      expect(result).not.toContain("document.getElementById('root') || document.body");
    });

    it('should send a report on bridge:ready', () => {
      const result = generateBridgeIIFE();
      expect(result).toContain("window.addEventListener('bridge:ready'");
    });

    it('should respect autoResize:false (opt-out short-circuit)', () => {
      const result = generateBridgeIIFE();
      expect(result).toContain('sizing.autoResize === false');
    });

    it('should report size through the bridge setSize API', () => {
      const result = generateBridgeIIFE();
      expect(result).toContain('FrontMcpBridge.prototype.setSize');
      expect(result).toContain('window.FrontMcpBridge.setSize');
    });

    it('should debounce reports via requestAnimationFrame', () => {
      const result = generateBridgeIIFE();
      expect(result).toContain('requestAnimationFrame');
    });

    it('is present even when only generic adapter is selected', () => {
      const result = generateBridgeIIFE({ adapters: ['generic'] });
      expect(result).toContain('__initAutoResize');
      expect(result).toContain('window.__mcpWidgetSizing');
    });

    it('survives minification', () => {
      const result = generateBridgeIIFE({ minify: true });
      expect(result).toContain('__initAutoResize');
      expect(result).toContain('__mcpWidgetSizing');
      // The minifier drops spaces around punctuation, even inside strings; the
      // selector and CSS keyword the bridge relies on have none.
      expect(result).toContain("'fit-content'");
      expect(result).toContain(`'meta[name="color-scheme"]'`);
    });
  });

  describe('host theme', () => {
    it('should apply the host theme from notifyContextChange', () => {
      const result = generateBridgeIIFE();
      expect(result).toContain('function __applyHostTheme(theme)');
      expect(result).toContain('if (changes && changes.theme) __applyHostTheme(changes.theme);');
    });

    it('should notify context changes from the ext-apps handshake instead of merging silently', () => {
      const result = generateBridgeIIFE({ adapters: ['ext-apps', 'generic'] });
      expect(result).toContain('context.notifyContextChange(result.hostContext)');
      expect(result).not.toContain('Object.assign(context.hostContext, result.hostContext)');
    });
  });
});
