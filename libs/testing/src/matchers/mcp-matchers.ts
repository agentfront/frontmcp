/**
 * @file mcp-matchers.ts
 * @description Custom Jest matchers for MCP testing
 *
 * @example
 * ```typescript
 * import { test, expect } from '@frontmcp/testing';
 *
 * test('tools work', async ({ mcp }) => {
 *   const tools = await mcp.tools.list();
 *   expect(tools).toContainTool('my-tool');
 *
 *   const result = await mcp.tools.call('my-tool', {});
 *   expect(result).toBeSuccessful();
 *   expect(result).toHaveTextContent();
 * });
 * ```
 */

import type { MatcherFunction } from 'expect';
import type { Tool, Resource, ResourceTemplate, Prompt } from '@modelcontextprotocol/sdk/types.js';
import type { ToolResultWrapper, ResourceContentWrapper, PromptResultWrapper } from '../client/mcp-test-client.types';

// ═══════════════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════════════

type ResultWrapper = ToolResultWrapper | ResourceContentWrapper;

// ═══════════════════════════════════════════════════════════════════
// TOOL MATCHERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if tools array contains a tool with the given name
 */
const toContainTool: MatcherFunction<[toolName: string]> = function (received, toolName) {
  const tools = received as Tool[];

  if (!Array.isArray(tools)) {
    return {
      pass: false,
      message: () => `Expected an array of tools, but received ${typeof received}`,
    };
  }

  const pass = tools.some((t) => t.name === toolName);
  const availableTools = tools.map((t) => t.name).join(', ');

  return {
    pass,
    message: () =>
      pass
        ? `Expected tools not to contain "${toolName}"`
        : `Expected tools to contain "${toolName}", but got: [${availableTools}]`,
  };
};

/**
 * Check if result is successful (not an error)
 */
const toBeSuccessful: MatcherFunction<[]> = function (received) {
  const result = received as ResultWrapper;

  if (typeof result !== 'object' || result === null || !('isSuccess' in result)) {
    return {
      pass: false,
      message: () => `Expected a result wrapper object with isSuccess property`,
    };
  }

  const pass = result.isSuccess;

  return {
    pass,
    message: () =>
      pass
        ? 'Expected result not to be successful'
        : `Expected result to be successful, but got error: ${result.error?.message ?? 'unknown error'}`,
  };
};

/**
 * Check if result is an error, optionally with a specific error code
 */
const toBeError: MatcherFunction<[expectedCode?: number]> = function (received, expectedCode) {
  const result = received as ResultWrapper;

  if (typeof result !== 'object' || result === null || !('isError' in result)) {
    return {
      pass: false,
      message: () => `Expected a result wrapper object with isError property`,
    };
  }

  let pass = result.isError;

  if (pass && expectedCode !== undefined) {
    pass = result.error?.code === expectedCode;
  }

  return {
    pass,
    message: () => {
      if (!result.isError) {
        return 'Expected result to be an error, but it was successful';
      }
      if (expectedCode !== undefined && result.error?.code !== expectedCode) {
        return `Expected error code ${expectedCode}, but got ${result.error?.code}`;
      }
      return 'Expected result not to be an error';
    },
  };
};

/**
 * Check if tool result has text content, optionally containing specific text
 */
const toHaveTextContent: MatcherFunction<[expectedText?: string]> = function (received, expectedText) {
  const result = received as ToolResultWrapper;

  if (typeof result !== 'object' || result === null || !('hasTextContent' in result)) {
    return {
      pass: false,
      message: () => `Expected a ToolResultWrapper object with hasTextContent method`,
    };
  }

  const hasText = result.hasTextContent();
  const text = result.text();
  let pass = hasText;

  if (pass && expectedText !== undefined) {
    pass = text?.includes(expectedText) ?? false;
  }

  return {
    pass,
    message: () => {
      if (!hasText) {
        return 'Expected result to have text content';
      }
      if (expectedText !== undefined && !text?.includes(expectedText)) {
        return `Expected text to contain "${expectedText}", but got: "${text}"`;
      }
      return 'Expected result not to have text content';
    },
  };
};

/**
 * Check if tool result has image content
 */
const toHaveImageContent: MatcherFunction<[]> = function (received) {
  const result = received as ToolResultWrapper;

  if (typeof result !== 'object' || result === null || !('hasImageContent' in result)) {
    return {
      pass: false,
      message: () => `Expected a ToolResultWrapper object with hasImageContent method`,
    };
  }

  const pass = result.hasImageContent();

  return {
    pass,
    message: () => (pass ? 'Expected result not to have image content' : 'Expected result to have image content'),
  };
};

/**
 * Check if tool result has resource content
 */
const toHaveResourceContent: MatcherFunction<[]> = function (received) {
  const result = received as ToolResultWrapper;

  if (typeof result !== 'object' || result === null || !('hasResourceContent' in result)) {
    return {
      pass: false,
      message: () => `Expected a ToolResultWrapper object with hasResourceContent method`,
    };
  }

  const pass = result.hasResourceContent();

  return {
    pass,
    message: () => (pass ? 'Expected result not to have resource content' : 'Expected result to have resource content'),
  };
};

// ═══════════════════════════════════════════════════════════════════
// RESOURCE MATCHERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if resources array contains a resource with the given URI
 */
const toContainResource: MatcherFunction<[uri: string]> = function (received, uri) {
  const resources = received as Resource[];

  if (!Array.isArray(resources)) {
    return {
      pass: false,
      message: () => `Expected an array of resources, but received ${typeof received}`,
    };
  }

  const pass = resources.some((r) => r.uri === uri);
  const availableUris = resources.map((r) => r.uri).join(', ');

  return {
    pass,
    message: () =>
      pass
        ? `Expected resources not to contain "${uri}"`
        : `Expected resources to contain "${uri}", but got: [${availableUris}]`,
  };
};

/**
 * Check if resource templates array contains a template with the given URI template
 */
const toContainResourceTemplate: MatcherFunction<[uriTemplate: string]> = function (received, uriTemplate) {
  const templates = received as ResourceTemplate[];

  if (!Array.isArray(templates)) {
    return {
      pass: false,
      message: () => `Expected an array of resource templates, but received ${typeof received}`,
    };
  }

  const pass = templates.some((t) => t.uriTemplate === uriTemplate);
  const availableTemplates = templates.map((t) => t.uriTemplate).join(', ');

  return {
    pass,
    message: () =>
      pass
        ? `Expected templates not to contain "${uriTemplate}"`
        : `Expected templates to contain "${uriTemplate}", but got: [${availableTemplates}]`,
  };
};

/**
 * Check if resource content has a specific MIME type
 */
const toHaveMimeType: MatcherFunction<[mimeType: string]> = function (received, mimeType) {
  const result = received as ResourceContentWrapper;

  if (typeof result !== 'object' || result === null || !('hasMimeType' in result)) {
    return {
      pass: false,
      message: () => `Expected a ResourceContentWrapper object with hasMimeType method`,
    };
  }

  const pass = result.hasMimeType(mimeType);
  const actualMimeType = result.mimeType();

  return {
    pass,
    message: () =>
      pass
        ? `Expected content not to have MIME type "${mimeType}"`
        : `Expected MIME type "${mimeType}", but got "${actualMimeType}"`,
  };
};

// ═══════════════════════════════════════════════════════════════════
// PROMPT MATCHERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if prompts array contains a prompt with the given name
 */
const toContainPrompt: MatcherFunction<[name: string]> = function (received, name) {
  const prompts = received as Prompt[];

  if (!Array.isArray(prompts)) {
    return {
      pass: false,
      message: () => `Expected an array of prompts, but received ${typeof received}`,
    };
  }

  const pass = prompts.some((p) => p.name === name);
  const availablePrompts = prompts.map((p) => p.name).join(', ');

  return {
    pass,
    message: () =>
      pass
        ? `Expected prompts not to contain "${name}"`
        : `Expected prompts to contain "${name}", but got: [${availablePrompts}]`,
  };
};

/**
 * Check if prompt result has a specific number of messages
 */
const toHaveMessages: MatcherFunction<[count: number]> = function (received, count) {
  const result = received as PromptResultWrapper;

  if (typeof result !== 'object' || result === null || !('messages' in result)) {
    return {
      pass: false,
      message: () => `Expected a PromptResultWrapper object with messages property`,
    };
  }

  const actualCount = result.messages?.length ?? 0;
  const pass = actualCount === count;

  return {
    pass,
    message: () =>
      pass
        ? `Expected prompt not to have ${count} messages`
        : `Expected prompt to have ${count} messages, but got ${actualCount}`,
  };
};

// ═══════════════════════════════════════════════════════════════════
// PROTOCOL MATCHERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if response is valid JSON-RPC 2.0
 */
const toBeValidJsonRpc: MatcherFunction<[]> = function (received) {
  const response = received as Record<string, unknown>;

  if (typeof response !== 'object' || response === null) {
    return {
      pass: false,
      message: () => `Expected an object, but received ${typeof received}`,
    };
  }

  const pass = response['jsonrpc'] === '2.0' && ('result' in response || 'error' in response);

  return {
    pass,
    message: () =>
      pass
        ? 'Expected response not to be valid JSON-RPC'
        : `Expected valid JSON-RPC 2.0 response with "result" or "error"`,
  };
};

/**
 * Check if JSON-RPC response has a result
 */
const toHaveResult: MatcherFunction<[]> = function (received) {
  const response = received as Record<string, unknown>;

  if (typeof response !== 'object' || response === null) {
    return {
      pass: false,
      message: () => `Expected an object, but received ${typeof received}`,
    };
  }

  const pass = 'result' in response;

  return {
    pass,
    message: () => (pass ? 'Expected response not to have result' : 'Expected response to have result'),
  };
};

/**
 * Check if JSON-RPC response has an error
 */
const toHaveError: MatcherFunction<[]> = function (received) {
  const response = received as Record<string, unknown>;

  if (typeof response !== 'object' || response === null) {
    return {
      pass: false,
      message: () => `Expected an object, but received ${typeof received}`,
    };
  }

  const pass = 'error' in response;

  return {
    pass,
    message: () => (pass ? 'Expected response not to have error' : 'Expected response to have error'),
  };
};

/**
 * Check if JSON-RPC response has a specific error code
 */
const toHaveErrorCode: MatcherFunction<[code: number]> = function (received, code) {
  const response = received as { error?: { code: number } };

  if (typeof response !== 'object' || response === null) {
    return {
      pass: false,
      message: () => `Expected an object, but received ${typeof received}`,
    };
  }

  const actualCode = response.error?.code;
  const pass = actualCode === code;

  return {
    pass,
    message: () =>
      pass
        ? `Expected response not to have error code ${code}`
        : `Expected error code ${code}, but got ${actualCode ?? 'no error'}`,
  };
};

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

/**
 * All MCP matchers as an object for expect.extend()
 */
export const mcpMatchers = {
  // Tool matchers
  toContainTool,
  toBeSuccessful,
  toBeError,
  toHaveTextContent,
  toHaveImageContent,
  toHaveResourceContent,

  // Resource matchers
  toContainResource,
  toContainResourceTemplate,
  toHaveMimeType,

  // Prompt matchers
  toContainPrompt,
  toHaveMessages,

  // Protocol matchers
  toBeValidJsonRpc,
  toHaveResult,
  toHaveError,
  toHaveErrorCode,
};
