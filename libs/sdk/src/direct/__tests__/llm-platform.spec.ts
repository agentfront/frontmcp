/**
 * LLM Platform Detection and Formatting Tests
 */

import type { Tool as McpTool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  detectPlatform,
  formatToolsForPlatform,
  formatResultForPlatform,
  PLATFORM_CLIENT_INFO,
  type OpenAITool,
  type ClaudeTool,
  type LangChainTool,
  type VercelAITools,
} from '../llm-platform';
import type { ClientInfo, LLMPlatform } from '../client.types';

describe('llm-platform', () => {
  describe('PLATFORM_CLIENT_INFO', () => {
    it('should have client info for all platforms', () => {
      const platforms: LLMPlatform[] = ['openai', 'claude', 'langchain', 'vercel-ai', 'raw'];

      for (const platform of platforms) {
        expect(PLATFORM_CLIENT_INFO[platform]).toBeDefined();
        expect(PLATFORM_CLIENT_INFO[platform].name).toBeTruthy();
        expect(PLATFORM_CLIENT_INFO[platform].version).toBeTruthy();
      }
    });

    it('should have correct client info values', () => {
      expect(PLATFORM_CLIENT_INFO.openai).toEqual({ name: 'openai', version: '1.0.0' });
      expect(PLATFORM_CLIENT_INFO.claude).toEqual({ name: 'claude', version: '1.0.0' });
      expect(PLATFORM_CLIENT_INFO.langchain).toEqual({ name: 'langchain', version: '1.0.0' });
      expect(PLATFORM_CLIENT_INFO['vercel-ai']).toEqual({ name: 'vercel-ai', version: '1.0.0' });
      expect(PLATFORM_CLIENT_INFO.raw).toEqual({ name: 'mcp-client', version: '1.0.0' });
    });
  });

  describe('detectPlatform', () => {
    it('should detect OpenAI from various client names', () => {
      const clientNames = ['openai', 'OpenAI', 'openai-agent', 'my-openai-client', 'gpt-agent', 'gpt4-client'];

      for (const name of clientNames) {
        const clientInfo: ClientInfo = { name, version: '1.0.0' };
        expect(detectPlatform(clientInfo)).toBe('openai');
      }
    });

    it('should detect Claude from various client names', () => {
      const clientNames = ['claude', 'Claude', 'claude-agent', 'anthropic', 'anthropic-client'];

      for (const name of clientNames) {
        const clientInfo: ClientInfo = { name, version: '1.0.0' };
        expect(detectPlatform(clientInfo)).toBe('claude');
      }
    });

    it('should detect LangChain from various client names', () => {
      const clientNames = ['langchain', 'LangChain', 'langchain-agent', 'my-langchain-client'];

      for (const name of clientNames) {
        const clientInfo: ClientInfo = { name, version: '1.0.0' };
        expect(detectPlatform(clientInfo)).toBe('langchain');
      }
    });

    it('should detect Vercel AI from various client names', () => {
      const clientNames = ['vercel', 'vercel-ai', 'ai-sdk', 'vercel-sdk', 'my-ai-sdk-client'];

      for (const name of clientNames) {
        const clientInfo: ClientInfo = { name, version: '1.0.0' };
        expect(detectPlatform(clientInfo)).toBe('vercel-ai');
      }
    });

    it('should return raw for unknown client names', () => {
      const clientNames = ['my-agent', 'custom-client', 'unknown', 'mcp-client'];

      for (const name of clientNames) {
        const clientInfo: ClientInfo = { name, version: '1.0.0' };
        expect(detectPlatform(clientInfo)).toBe('raw');
      }
    });
  });

  describe('formatToolsForPlatform', () => {
    const createMockTools = (): McpTool[] => [
      {
        name: 'get_weather',
        description: 'Get current weather',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
            units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['city'],
        },
      },
      {
        name: 'search',
        description: 'Search the web',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    ];

    describe('OpenAI format', () => {
      it('should format tools for OpenAI', () => {
        const tools = createMockTools();
        const formatted = formatToolsForPlatform(tools, 'openai') as OpenAITool[];

        expect(formatted).toHaveLength(2);
        expect(formatted[0]).toMatchObject({
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather',
            strict: true,
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string', description: 'City name' },
                units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
              },
              required: ['city'],
              additionalProperties: false,
            },
          },
        });
      });

      it('should add additionalProperties: false for OpenAI strict mode', () => {
        const tools: McpTool[] = [
          {
            name: 'test',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ];

        const formatted = formatToolsForPlatform(tools, 'openai') as OpenAITool[];
        expect(formatted[0].function.parameters).toHaveProperty('additionalProperties', false);
      });

      it('should recursively sanitize nested objects', () => {
        const tools: McpTool[] = [
          {
            name: 'test',
            inputSchema: {
              type: 'object',
              properties: {
                nested: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                  },
                },
              },
            },
          },
        ];

        const formatted = formatToolsForPlatform(tools, 'openai') as OpenAITool[];
        const nested = formatted[0].function.parameters.properties as Record<string, Record<string, unknown>>;
        expect(nested['nested']).toHaveProperty('additionalProperties', false);
      });

      it('should handle non-object property values', () => {
        const tools: McpTool[] = [
          {
            name: 'test',
            inputSchema: {
              type: 'object',
              properties: {
                simple: 'not-an-object' as unknown as Record<string, unknown>,
              },
            },
          },
        ];

        // Should not throw
        const formatted = formatToolsForPlatform(tools, 'openai') as OpenAITool[];
        expect(formatted[0].function.parameters.properties).toHaveProperty('simple', 'not-an-object');
      });
    });

    describe('Claude format', () => {
      it('should format tools for Claude', () => {
        const tools = createMockTools();
        const formatted = formatToolsForPlatform(tools, 'claude') as ClaudeTool[];

        expect(formatted).toHaveLength(2);
        expect(formatted[0]).toMatchObject({
          name: 'get_weather',
          description: 'Get current weather',
          input_schema: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'City name' },
            },
            required: ['city'],
          },
        });
      });

      it('should preserve original schema without additionalProperties', () => {
        const tools: McpTool[] = [
          {
            name: 'test',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ];

        const formatted = formatToolsForPlatform(tools, 'claude') as ClaudeTool[];
        expect(formatted[0].input_schema).not.toHaveProperty('additionalProperties');
      });
    });

    describe('LangChain format', () => {
      it('should format tools for LangChain', () => {
        const tools = createMockTools();
        const formatted = formatToolsForPlatform(tools, 'langchain') as LangChainTool[];

        expect(formatted).toHaveLength(2);
        expect(formatted[0]).toMatchObject({
          name: 'get_weather',
          description: 'Get current weather',
          schema: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'City name' },
            },
          },
        });
      });

      it('should use default description when not provided', () => {
        const tools: McpTool[] = [
          {
            name: 'my_tool',
            inputSchema: { type: 'object' },
          },
        ];

        const formatted = formatToolsForPlatform(tools, 'langchain') as LangChainTool[];
        expect(formatted[0].description).toBe('Execute my_tool');
      });
    });

    describe('Vercel AI format', () => {
      it('should format tools for Vercel AI SDK', () => {
        const tools = createMockTools();
        const formatted = formatToolsForPlatform(tools, 'vercel-ai') as VercelAITools;

        expect(formatted).toHaveProperty('get_weather');
        expect(formatted).toHaveProperty('search');
        expect(formatted['get_weather']).toMatchObject({
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'City name' },
            },
          },
        });
      });

      it('should use default description when not provided', () => {
        const tools: McpTool[] = [
          {
            name: 'my_tool',
            inputSchema: { type: 'object' },
          },
        ];

        const formatted = formatToolsForPlatform(tools, 'vercel-ai') as VercelAITools;
        expect(formatted['my_tool'].description).toBe('Execute my_tool');
      });
    });

    describe('Raw format', () => {
      it('should return tools unchanged for raw platform', () => {
        const tools = createMockTools();
        const formatted = formatToolsForPlatform(tools, 'raw');

        expect(formatted).toBe(tools);
      });
    });

    it('should handle empty tools array', () => {
      const platforms: LLMPlatform[] = ['openai', 'claude', 'langchain', 'vercel-ai', 'raw'];

      for (const platform of platforms) {
        const formatted = formatToolsForPlatform([], platform);
        if (platform === 'vercel-ai') {
          expect(formatted).toEqual({});
        } else {
          expect(formatted).toEqual([]);
        }
      }
    });
  });

  describe('formatResultForPlatform', () => {
    const createTextResult = (text: string): CallToolResult => ({
      content: [{ type: 'text', text }],
    });

    const createJsonResult = (data: unknown): CallToolResult => ({
      content: [{ type: 'text', text: JSON.stringify(data) }],
    });

    describe('OpenAI format', () => {
      it('should extract text content', () => {
        const result = createTextResult('Hello, world!');
        const formatted = formatResultForPlatform(result, 'openai');
        expect(formatted).toBe('Hello, world!');
      });

      it('should parse JSON content', () => {
        const result = createJsonResult({ temperature: 72, unit: 'fahrenheit' });
        const formatted = formatResultForPlatform(result, 'openai');
        expect(formatted).toEqual({ temperature: 72, unit: 'fahrenheit' });
      });

      it('should combine multiple text contents', () => {
        const result: CallToolResult = {
          content: [
            { type: 'text', text: 'Line 1' },
            { type: 'text', text: 'Line 2' },
          ],
        };
        const formatted = formatResultForPlatform(result, 'openai');
        expect(formatted).toBe('Line 1\nLine 2');
      });

      it('should return empty string for empty content', () => {
        const result: CallToolResult = { content: [] };
        const formatted = formatResultForPlatform(result, 'openai');
        expect(formatted).toBe('');
      });

      it('should return empty string for no text content', () => {
        const result: CallToolResult = {
          content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
        };
        const formatted = formatResultForPlatform(result, 'openai');
        expect(formatted).toBe('');
      });
    });

    describe('LangChain format', () => {
      it('should extract text content (same as OpenAI)', () => {
        const result = createTextResult('Hello, world!');
        const formatted = formatResultForPlatform(result, 'langchain');
        expect(formatted).toBe('Hello, world!');
      });
    });

    describe('Claude format', () => {
      it('should return content array directly', () => {
        const result = createTextResult('Hello, world!');
        const formatted = formatResultForPlatform(result, 'claude');
        expect(formatted).toEqual([{ type: 'text', text: 'Hello, world!' }]);
      });

      it('should preserve image content', () => {
        const result: CallToolResult = {
          content: [
            { type: 'text', text: 'Image:' },
            { type: 'image', data: 'base64data', mimeType: 'image/png' },
          ],
        };
        const formatted = formatResultForPlatform(result, 'claude');
        expect(formatted).toBe(result.content);
      });
    });

    describe('Vercel AI format', () => {
      it('should parse JSON for single text content', () => {
        const result = createJsonResult({ status: 'success', data: [1, 2, 3] });
        const formatted = formatResultForPlatform(result, 'vercel-ai');
        expect(formatted).toEqual({ status: 'success', data: [1, 2, 3] });
      });

      it('should return plain text if not valid JSON', () => {
        const result = createTextResult('Plain text response');
        const formatted = formatResultForPlatform(result, 'vercel-ai');
        expect(formatted).toBe('Plain text response');
      });

      it('should return structured object for multiple contents', () => {
        const result: CallToolResult = {
          content: [
            { type: 'text', text: 'Text 1' },
            { type: 'text', text: 'Text 2' },
            { type: 'image', data: 'base64data', mimeType: 'image/png' },
          ],
        };
        const formatted = formatResultForPlatform(result, 'vercel-ai');
        expect(formatted).toEqual({
          text: ['Text 1', 'Text 2'],
          images: [{ data: 'base64data', mimeType: 'image/png' }],
        });
      });

      it('should return null for empty content', () => {
        const result: CallToolResult = { content: [] };
        const formatted = formatResultForPlatform(result, 'vercel-ai');
        expect(formatted).toBeNull();
      });

      it('should handle text-only multiple contents', () => {
        const result: CallToolResult = {
          content: [
            { type: 'text', text: 'A' },
            { type: 'text', text: 'B' },
          ],
        };
        const formatted = formatResultForPlatform(result, 'vercel-ai') as { text: string[]; images?: unknown[] };
        expect(formatted.text).toEqual(['A', 'B']);
        expect(formatted.images).toBeUndefined();
      });

      it('should handle image-only multiple contents', () => {
        const result: CallToolResult = {
          content: [
            { type: 'image', data: 'img1', mimeType: 'image/png' },
            { type: 'image', data: 'img2', mimeType: 'image/jpeg' },
          ],
        };
        const formatted = formatResultForPlatform(result, 'vercel-ai') as { text?: string[]; images: unknown[] };
        expect(formatted.text).toBeUndefined();
        expect(formatted.images).toEqual([
          { data: 'img1', mimeType: 'image/png' },
          { data: 'img2', mimeType: 'image/jpeg' },
        ]);
      });
    });

    describe('Raw format', () => {
      it('should return full CallToolResult', () => {
        const result = createTextResult('Hello');
        const formatted = formatResultForPlatform(result, 'raw');
        expect(formatted).toBe(result);
      });
    });

    it('should handle undefined content', () => {
      const result: CallToolResult = { content: undefined as unknown as [] };
      const formatted = formatResultForPlatform(result, 'openai');
      expect(formatted).toBe('');
    });
  });
});
