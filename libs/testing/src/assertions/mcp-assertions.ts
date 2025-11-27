/**
 * @file mcp-assertions.ts
 * @description MCP-specific test assertions
 */

import type { McpResponse, ToolResultWrapper, ResourceContentWrapper, McpErrorInfo } from '../client';
import type {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';

// ═══════════════════════════════════════════════════════════════════
// ASSERTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * MCP-specific assertion helpers
 */
export const McpAssertions = {
  /**
   * Assert that an MCP response was successful and return the data
   * @throws Error if response was not successful
   */
  assertSuccess<T>(response: McpResponse<T>, message?: string): T {
    if (!response.success) {
      const errorMsg = response.error?.message ?? 'Unknown error';
      throw new Error(message ?? `Expected success but got error: ${errorMsg} (code: ${response.error?.code})`);
    }
    if (response.data === undefined) {
      throw new Error(message ?? 'Expected data but got undefined');
    }
    return response.data;
  },

  /**
   * Assert that an MCP response was an error
   * @param expectedCode Optional expected error code
   */
  assertError<T>(response: McpResponse<T>, expectedCode?: number): McpErrorInfo {
    if (response.success) {
      throw new Error('Expected error but got success');
    }
    if (!response.error) {
      throw new Error('Expected error info but got undefined');
    }
    if (expectedCode !== undefined && response.error.code !== expectedCode) {
      throw new Error(`Expected error code ${expectedCode} but got ${response.error.code}: ${response.error.message}`);
    }
    return response.error;
  },

  /**
   * Assert that a tool call was successful (not isError)
   */
  assertToolSuccess(result: ToolResultWrapper | McpResponse<CallToolResult>): void {
    if ('raw' in result) {
      // ToolResultWrapper
      if (result.isError) {
        throw new Error(`Tool call failed: ${result.error?.message ?? 'Unknown error'}`);
      }
    } else {
      // McpResponse<CallToolResult>
      if (!result.success) {
        throw new Error(`Tool call failed: ${result.error?.message ?? 'Unknown error'}`);
      }
      if (result.data?.isError) {
        throw new Error('Tool returned isError=true');
      }
    }
  },

  /**
   * Assert that a tool result has specific content type
   */
  assertToolContent(
    result: ToolResultWrapper | McpResponse<CallToolResult>,
    type: 'text' | 'image' | 'resource',
  ): void {
    let content: CallToolResult['content'];

    if ('raw' in result) {
      content = result.raw.content;
    } else {
      if (!result.success || !result.data) {
        throw new Error('Tool call was not successful');
      }
      content = result.data.content;
    }

    const hasContent = content?.some((c) => c.type === type);
    if (!hasContent) {
      throw new Error(`Expected tool result to have ${type} content`);
    }
  },

  /**
   * Assert that a resource read was successful and return the text content
   */
  assertTextResource(response: ResourceContentWrapper | McpResponse<ReadResourceResult>): string {
    if ('raw' in response) {
      // ResourceContentWrapper
      if (response.isError) {
        throw new Error(`Resource read failed: ${response.error?.message ?? 'Unknown error'}`);
      }
      const text = response.text();
      if (text === undefined) {
        throw new Error('Expected text content but got undefined');
      }
      return text;
    } else {
      // McpResponse<ReadResourceResult>
      if (!response.success || !response.data) {
        throw new Error(`Resource read failed: ${response.error?.message ?? 'Unknown error'}`);
      }
      const content = response.data.contents?.[0];
      if (!content || !('text' in content)) {
        throw new Error('Expected text content but got undefined');
      }
      return content.text;
    }
  },

  /**
   * Assert that tools array contains a tool with given name
   */
  assertContainsTool(tools: Tool[], name: string): Tool {
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      const available = tools.map((t) => t.name).join(', ');
      throw new Error(`Expected to find tool "${name}" but got: [${available}]`);
    }
    return tool;
  },

  /**
   * Assert that resources array contains a resource with given URI
   */
  assertContainsResource(resources: Resource[], uri: string): Resource {
    const resource = resources.find((r) => r.uri === uri);
    if (!resource) {
      const available = resources.map((r) => r.uri).join(', ');
      throw new Error(`Expected to find resource "${uri}" but got: [${available}]`);
    }
    return resource;
  },

  /**
   * Assert that resource templates array contains a template with given URI template
   */
  assertContainsResourceTemplate(templates: ResourceTemplate[], uriTemplate: string): ResourceTemplate {
    const template = templates.find((t) => t.uriTemplate === uriTemplate);
    if (!template) {
      const available = templates.map((t) => t.uriTemplate).join(', ');
      throw new Error(`Expected to find resource template "${uriTemplate}" but got: [${available}]`);
    }
    return template;
  },

  /**
   * Assert that prompts array contains a prompt with given name
   */
  assertContainsPrompt(prompts: Prompt[], name: string): Prompt {
    const prompt = prompts.find((p) => p.name === name);
    if (!prompt) {
      const available = prompts.map((p) => p.name).join(', ');
      throw new Error(`Expected to find prompt "${name}" but got: [${available}]`);
    }
    return prompt;
  },
};

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS FOR CUSTOM MATCHERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if tools array contains a tool with given name
 */
export function containsTool(tools: Tool[], name: string): boolean {
  return tools.some((t) => t.name === name);
}

/**
 * Check if resources array contains a resource with given URI
 */
export function containsResource(resources: Resource[], uri: string): boolean {
  return resources.some((r) => r.uri === uri);
}

/**
 * Check if resource templates array contains a template with given URI template
 */
export function containsResourceTemplate(templates: ResourceTemplate[], uriTemplate: string): boolean {
  return templates.some((t) => t.uriTemplate === uriTemplate);
}

/**
 * Check if prompts array contains a prompt with given name
 */
export function containsPrompt(prompts: Prompt[], name: string): boolean {
  return prompts.some((p) => p.name === name);
}

/**
 * Check if result is successful
 */
export function isSuccessful(result: ToolResultWrapper | ResourceContentWrapper): boolean {
  return result.isSuccess;
}

/**
 * Check if result is an error
 */
export function isError(result: ToolResultWrapper | ResourceContentWrapper, expectedCode?: number): boolean {
  if (!result.isError) return false;
  if (expectedCode !== undefined) {
    return result.error?.code === expectedCode;
  }
  return true;
}

/**
 * Check if result has text content
 */
export function hasTextContent(result: ToolResultWrapper): boolean {
  return result.hasTextContent();
}

/**
 * Check if resource has specific MIME type
 */
export function hasMimeType(result: ResourceContentWrapper, mimeType: string): boolean {
  return result.hasMimeType(mimeType);
}
