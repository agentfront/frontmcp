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
  });
});
