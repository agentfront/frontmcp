import type { PlatformDetectionConfig } from '../../common';
import {
  detectAIPlatform,
  detectPlatformFromUserAgent,
  resolvePlatformType,
  type AIPlatformType,
  type ClientInfo,
} from '../notification.service';

describe('detectAIPlatform', () => {
  describe('when clientInfo is undefined or empty', () => {
    it('should return "unknown" when clientInfo is undefined', () => {
      expect(detectAIPlatform(undefined)).toBe('unknown');
    });

    it('should return "unknown" when clientInfo.name is empty', () => {
      expect(detectAIPlatform({ name: '', version: '1.0' })).toBe('unknown');
    });
  });

  describe('OpenAI platform detection', () => {
    const testCases: Array<{ name: string; expected: AIPlatformType }> = [
      { name: 'ChatGPT', expected: 'openai' },
      { name: 'chatgpt-client', expected: 'openai' },
      { name: 'openai-cli', expected: 'openai' },
      { name: 'OpenAI Desktop', expected: 'openai' },
      { name: 'gpt-agent', expected: 'openai' },
      { name: 'GPT-4 Client', expected: 'openai' },
    ];

    test.each(testCases)('should detect "$name" as openai', ({ name, expected }) => {
      const clientInfo: ClientInfo = { name, version: '1.0.0' };
      expect(detectAIPlatform(clientInfo)).toBe(expected);
    });
  });

  describe('Claude platform detection', () => {
    const testCases: Array<{ name: string; expected: AIPlatformType }> = [
      { name: 'Claude Desktop', expected: 'claude' },
      { name: 'claude-cli', expected: 'claude' },
      { name: 'Anthropic Client', expected: 'claude' },
      { name: 'anthropic-mcp', expected: 'claude' },
    ];

    test.each(testCases)('should detect "$name" as claude', ({ name, expected }) => {
      const clientInfo: ClientInfo = { name, version: '1.0.0' };
      expect(detectAIPlatform(clientInfo)).toBe(expected);
    });
  });

  describe('Gemini platform detection', () => {
    const testCases: Array<{ name: string; expected: AIPlatformType }> = [
      { name: 'Gemini', expected: 'gemini' },
      { name: 'gemini-client', expected: 'gemini' },
      { name: 'Google AI', expected: 'gemini' },
      { name: 'google-ai-client', expected: 'gemini' },
      { name: 'Bard', expected: 'gemini' },
      { name: 'bard-agent', expected: 'gemini' },
      // Note: "google-mcp" is detected as 'generic-mcp' to avoid false positives
      // like "google-drive-connector" being detected as gemini
    ];

    test.each(testCases)('should detect "$name" as gemini', ({ name, expected }) => {
      const clientInfo: ClientInfo = { name, version: '1.0.0' };
      expect(detectAIPlatform(clientInfo)).toBe(expected);
    });
  });

  describe('Cursor platform detection', () => {
    const testCases: Array<{ name: string; expected: AIPlatformType }> = [
      { name: 'Cursor', expected: 'cursor' },
      { name: 'cursor-mcp', expected: 'cursor' },
      { name: 'Cursor IDE', expected: 'cursor' },
    ];

    test.each(testCases)('should detect "$name" as cursor', ({ name, expected }) => {
      const clientInfo: ClientInfo = { name, version: '1.0.0' };
      expect(detectAIPlatform(clientInfo)).toBe(expected);
    });
  });

  describe('Continue platform detection', () => {
    const testCases: Array<{ name: string; expected: AIPlatformType }> = [
      { name: 'Continue', expected: 'continue' },
      { name: 'continue-dev', expected: 'continue' },
      { name: 'Continue.dev', expected: 'continue' },
    ];

    test.each(testCases)('should detect "$name" as continue', ({ name, expected }) => {
      const clientInfo: ClientInfo = { name, version: '1.0.0' };
      expect(detectAIPlatform(clientInfo)).toBe(expected);
    });
  });

  describe('Cody platform detection', () => {
    const testCases: Array<{ name: string; expected: AIPlatformType }> = [
      { name: 'Cody', expected: 'cody' },
      { name: 'cody-client', expected: 'cody' },
      { name: 'Sourcegraph Cody', expected: 'cody' },
      { name: 'sourcegraph-mcp', expected: 'cody' },
    ];

    test.each(testCases)('should detect "$name" as cody', ({ name, expected }) => {
      const clientInfo: ClientInfo = { name, version: '1.0.0' };
      expect(detectAIPlatform(clientInfo)).toBe(expected);
    });
  });

  describe('Generic MCP client detection', () => {
    const testCases: Array<{ name: string; expected: AIPlatformType }> = [
      { name: 'mcp-client', expected: 'generic-mcp' },
      { name: 'MCP Inspector', expected: 'generic-mcp' },
      { name: 'generic-mcp-client', expected: 'generic-mcp' },
    ];

    test.each(testCases)('should detect "$name" as generic-mcp', ({ name, expected }) => {
      const clientInfo: ClientInfo = { name, version: '1.0.0' };
      expect(detectAIPlatform(clientInfo)).toBe(expected);
    });
  });

  describe('Unknown clients', () => {
    const testCases: Array<{ name: string }> = [
      { name: 'Custom Agent' },
      { name: 'my-app' },
      { name: 'Test Client' },
      { name: 'Unknown' },
    ];

    test.each(testCases)('should return "unknown" for "$name"', ({ name }) => {
      const clientInfo: ClientInfo = { name, version: '1.0.0' };
      expect(detectAIPlatform(clientInfo)).toBe('unknown');
    });
  });

  describe('case insensitivity', () => {
    it('should detect clients regardless of case', () => {
      expect(detectAIPlatform({ name: 'CHATGPT', version: '1.0' })).toBe('openai');
      expect(detectAIPlatform({ name: 'CLAUDE', version: '1.0' })).toBe('claude');
      expect(detectAIPlatform({ name: 'GEMINI', version: '1.0' })).toBe('gemini');
      expect(detectAIPlatform({ name: 'CURSOR', version: '1.0' })).toBe('cursor');
    });
  });
});

describe('resolvePlatformType (#681)', () => {
  const mcpApps = { experimental: { 'io.modelcontextprotocol/ui': {} } };
  const gemini: ClientInfo = { name: 'gemini-cli', version: '1.0.0' };

  it('treats a client that declares MCP Apps as ext-apps, whatever its name', () => {
    expect(resolvePlatformType(gemini, mcpApps)).toBe('ext-apps');
    expect(resolvePlatformType({ name: 'ChatGPT', version: '1' }, mcpApps)).toBe('ext-apps');
  });

  it('finds MCP Apps under the SEP-2133 extensions too', () => {
    expect(resolvePlatformType(gemini, { extensions: { 'io.modelcontextprotocol/ui': {} } })).toBe('ext-apps');
  });

  it('lets a platformDetection mapping win over the MCP Apps capability', () => {
    const config: PlatformDetectionConfig = { mappings: [{ pattern: 'gemini-cli', platform: 'gemini' }] };
    expect(resolvePlatformType(gemini, mcpApps, config)).toBe('gemini');
    expect(resolvePlatformType({ name: 'Claude', version: '1' }, mcpApps, config)).toBe('ext-apps');
  });

  it.each([/acme/g, /acme/y])('matches a %s mapping on every call, not every other one', (pattern) => {
    const acme: ClientInfo = { name: 'acme-agent', version: '1' };
    const config: PlatformDetectionConfig = { mappings: [{ pattern, platform: 'openai' }] };
    const fromInitialize = [1, 2, 3].map(() => resolvePlatformType(acme, mcpApps, config));
    const fromUserAgent = [1, 2].map(() => detectPlatformFromUserAgent('acme-agent/1.0', config));
    expect(fromInitialize).toEqual(['openai', 'openai', 'openai']);
    expect(fromUserAgent).toEqual(['openai', 'openai']);
  });

  it('falls back to the client name without the capability', () => {
    expect(resolvePlatformType(gemini, {})).toBe('gemini');
    expect(resolvePlatformType(gemini, undefined)).toBe('gemini');
  });

  it('keeps MCP Apps detection with customOnly, and guesses nothing else', () => {
    const config: PlatformDetectionConfig = { customOnly: true };
    expect(resolvePlatformType(gemini, mcpApps, config)).toBe('ext-apps');
    expect(resolvePlatformType(gemini, {}, config)).toBe('unknown');
  });

  it('resolves a client without client info from its capabilities alone', () => {
    expect(resolvePlatformType(undefined, mcpApps)).toBe('ext-apps');
    expect(resolvePlatformType(undefined, {})).toBe('unknown');
  });
});
