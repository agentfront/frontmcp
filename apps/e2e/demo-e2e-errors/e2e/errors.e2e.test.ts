/**
 * E2E Tests for Error Handling
 *
 * Tests MCP error types and codes:
 * - InvalidInputError (validation)
 * - ResourceNotFoundError
 * - InternalMcpError
 * - Custom PublicMcpError
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Error Handling E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-errors/src/main.ts',
    publicMode: true,
  });

  test.describe('Validation Errors', () => {
    test('should throw validation error for invalid input', async ({ mcp }) => {
      const result = await mcp.tools.call('throw-validation-error', {
        value: 'ab', // Too short
        minLength: 5,
      });

      // Validate both error state and MCP error code for INVALID_PARAMS
      expect(result).toBeError(-32602);
      expect(result).toHaveTextContent('at least 5 characters');
    });

    test('should succeed with valid input', async ({ mcp }) => {
      const result = await mcp.tools.call('throw-validation-error', {
        value: 'validvalue',
        minLength: 5,
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('validvalue');
    });
  });

  test.describe('Not Found Errors', () => {
    test('should throw not found error for missing resource', async ({ mcp }) => {
      const result = await mcp.tools.call('throw-not-found', {
        resourceId: 'non-existent',
      });

      // Validate both error state and MCP error code for RESOURCE_NOT_FOUND
      expect(result).toBeError(-32002);
      expect(result).toHaveTextContent('not found');
    });

    test('should succeed for existing resource', async ({ mcp }) => {
      const result = await mcp.tools.call('throw-not-found', {
        resourceId: 'resource-1',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('resource-1');
    });
  });

  test.describe('Internal Errors', () => {
    test('should throw internal error when triggered', async ({ mcp }) => {
      const result = await mcp.tools.call('throw-internal-error', {
        trigger: true,
      });

      // Validate both error state and MCP error code for INTERNAL_ERROR
      expect(result).toBeError(-32603);
      // Internal errors should have error ID for support
      expect(result).toHaveTextContent('error');
    });

    test('should succeed when not triggered', async ({ mcp }) => {
      const result = await mcp.tools.call('throw-internal-error', {
        trigger: false,
      });

      expect(result).toBeSuccessful();
    });
  });

  test.describe('Custom Errors', () => {
    test('should throw custom error with specified code', async ({ mcp }) => {
      const result = await mcp.tools.call('throw-custom-error', {
        errorCode: 'CUSTOM_ERROR',
        errorMessage: 'This is a custom error',
        statusCode: 400,
      });

      // Custom errors should still be proper MCP errors
      expect(result).toBeError();
      expect(result).toHaveTextContent('custom error');
      // Assert errorCode is present in response
      expect(result).toHaveTextContent('CUSTOM_ERROR');
    });
  });

  test.describe('Successful Operations', () => {
    test('should return success for working tool', async ({ mcp }) => {
      const result = await mcp.tools.call('successful-tool', {
        message: 'All good!',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('All good!');
    });
  });

  test.describe('Resource Access', () => {
    test('should list error codes resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('errors://codes');
    });

    test('should read error codes', async ({ mcp }) => {
      const content = await mcp.resources.read('errors://codes');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('errorCodes');
      expect(content).toHaveTextContent('RESOURCE_NOT_FOUND');
      expect(content).toHaveTextContent('INTERNAL_ERROR');
    });
  });

  test.describe('Prompt Access', () => {
    test('should list error-explanation prompt', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('error-explanation');
    });

    test('should generate error explanation', async ({ mcp }) => {
      const result = await mcp.prompts.get('error-explanation', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      const message = result.messages[0];
      expect(message.role).toBe('user');
      expect(message.content.type).toBe('text');
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('MCP Error Codes Reference');
        // Verify all standard error codes are documented
        expect(message.content.text).toContain('INVALID_PARAMS');
        expect(message.content.text).toContain('RESOURCE_NOT_FOUND');
        expect(message.content.text).toContain('INTERNAL_ERROR');
      } else {
        throw new Error(`Expected text content type but got: ${message.content.type}`);
      }
    });

    test('should explain specific error code', async ({ mcp }) => {
      const result = await mcp.prompts.get('error-explanation', {
        errorCode: 'INTERNAL_ERROR',
      });

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBe(1);

      const message = result.messages[0];
      expect(message.role).toBe('user');
      expect(message.content.type).toBe('text');
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('Internal Error');
        expect(message.content.text).toContain('-32603');
      } else {
        throw new Error(`Expected text content type but got: ${message.content.type}`);
      }
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list all error demo tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('throw-validation-error');
      expect(tools).toContainTool('throw-not-found');
      expect(tools).toContainTool('throw-internal-error');
      expect(tools).toContainTool('throw-custom-error');
      expect(tools).toContainTool('successful-tool');
    });
  });
});
