/**
 * @file matcher-types.ts
 * @description TypeScript declarations for custom MCP Jest matchers
 *
 * This file extends Jest's expect interface with MCP-specific matchers.
 * Import this file or ensure it's included in your tsconfig to get type checking.
 */

// Note: These imports are used for documentation/JSDoc purposes in the interface comments
// The actual runtime types are in mcp-matchers.ts

/**
 * Custom MCP matchers for Jest
 */
export interface McpMatchers<R = unknown> {
  // ═══════════════════════════════════════════════════════════════════
  // TOOL MATCHERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Check if tools array contains a tool with the given name
   * @param toolName - The name of the tool to find
   *
   * @example
   * ```typescript
   * const tools = await mcp.tools.list();
   * expect(tools).toContainTool('my-tool');
   * ```
   */
  toContainTool(toolName: string): R;

  /**
   * Check if result is successful (not an error)
   *
   * @example
   * ```typescript
   * const result = await mcp.tools.call('my-tool', {});
   * expect(result).toBeSuccessful();
   * ```
   */
  toBeSuccessful(): R;

  /**
   * Check if result is an error, optionally with a specific error code
   * @param expectedCode - Optional specific MCP error code to match
   *
   * @example
   * ```typescript
   * const result = await mcp.tools.call('unknown-tool', {});
   * expect(result).toBeError();
   * expect(result).toBeError(-32601); // Method not found
   * ```
   */
  toBeError(expectedCode?: number): R;

  /**
   * Check if tool result has text content, optionally containing specific text
   * @param expectedText - Optional text that should be contained in the result
   *
   * @example
   * ```typescript
   * const result = await mcp.tools.call('my-tool', {});
   * expect(result).toHaveTextContent();
   * expect(result).toHaveTextContent('success');
   * ```
   */
  toHaveTextContent(expectedText?: string): R;

  /**
   * Check if tool result has image content
   *
   * @example
   * ```typescript
   * const result = await mcp.tools.call('generate-image', {});
   * expect(result).toHaveImageContent();
   * ```
   */
  toHaveImageContent(): R;

  /**
   * Check if tool result has resource content
   *
   * @example
   * ```typescript
   * const result = await mcp.tools.call('create-file', {});
   * expect(result).toHaveResourceContent();
   * ```
   */
  toHaveResourceContent(): R;

  // ═══════════════════════════════════════════════════════════════════
  // RESOURCE MATCHERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Check if resources array contains a resource with the given URI
   * @param uri - The URI of the resource to find
   *
   * @example
   * ```typescript
   * const resources = await mcp.resources.list();
   * expect(resources).toContainResource('notes://all');
   * ```
   */
  toContainResource(uri: string): R;

  /**
   * Check if resource templates array contains a template with the given URI template
   * @param uriTemplate - The URI template to find
   *
   * @example
   * ```typescript
   * const templates = await mcp.resources.listTemplates();
   * expect(templates).toContainResourceTemplate('notes://note/{id}');
   * ```
   */
  toContainResourceTemplate(uriTemplate: string): R;

  /**
   * Check if resource content has a specific MIME type
   * @param mimeType - The expected MIME type
   *
   * @example
   * ```typescript
   * const content = await mcp.resources.read('notes://all');
   * expect(content).toHaveMimeType('application/json');
   * ```
   */
  toHaveMimeType(mimeType: string): R;

  // ═══════════════════════════════════════════════════════════════════
  // PROMPT MATCHERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Check if prompts array contains a prompt with the given name
   * @param name - The name of the prompt to find
   *
   * @example
   * ```typescript
   * const prompts = await mcp.prompts.list();
   * expect(prompts).toContainPrompt('summarize');
   * ```
   */
  toContainPrompt(name: string): R;

  /**
   * Check if prompt result has a specific number of messages
   * @param count - The expected number of messages
   *
   * @example
   * ```typescript
   * const result = await mcp.prompts.get('summarize', {});
   * expect(result).toHaveMessages(2);
   * ```
   */
  toHaveMessages(count: number): R;

  // ═══════════════════════════════════════════════════════════════════
  // PROTOCOL MATCHERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Check if response is valid JSON-RPC 2.0
   *
   * @example
   * ```typescript
   * const response = await mcp.raw.request({ ... });
   * expect(response).toBeValidJsonRpc();
   * ```
   */
  toBeValidJsonRpc(): R;

  /**
   * Check if JSON-RPC response has a result
   *
   * @example
   * ```typescript
   * const response = await mcp.raw.request({ ... });
   * expect(response).toHaveResult();
   * ```
   */
  toHaveResult(): R;

  /**
   * Check if JSON-RPC response has an error
   *
   * @example
   * ```typescript
   * const response = await mcp.raw.request({ method: 'unknown' });
   * expect(response).toHaveError();
   * ```
   */
  toHaveError(): R;

  /**
   * Check if JSON-RPC response has a specific error code
   * @param code - The expected JSON-RPC error code
   *
   * @example
   * ```typescript
   * const response = await mcp.raw.request({ method: 'unknown' });
   * expect(response).toHaveErrorCode(-32601);
   * ```
   */
  toHaveErrorCode(code: number): R;
}

// ═══════════════════════════════════════════════════════════════════
// JEST TYPE AUGMENTATION
// ═══════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-empty-interface */
declare global {
  namespace jest {
    // Extend expect matchers
    interface Matchers<R> extends McpMatchers<R> {}

    // Extend asymmetric matchers (for expect.toContainTool etc.)
    interface Expect extends McpMatchers<void> {}

    // Extend inverse matchers (for expect.not.toContainTool etc.)
    interface InverseAsymmetricMatchers extends McpMatchers<void> {}
  }
}
/* eslint-enable @typescript-eslint/no-namespace */
/* eslint-enable @typescript-eslint/no-empty-interface */

// This export is needed to make this a module
export {};
