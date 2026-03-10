import { detectAIPlatform, type ClientInfo, type AIPlatformType } from '../notification.service';

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
