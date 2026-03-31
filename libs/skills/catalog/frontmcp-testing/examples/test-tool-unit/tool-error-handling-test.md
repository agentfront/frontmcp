---
name: tool-error-handling-test
reference: test-tool-unit
level: advanced
description: 'Test that a tool throws the correct MCP error classes with proper error codes and JSON-RPC error shapes.'
tags: [testing, json-rpc, tool, unit, error, handling]
features:
  - 'Verifying specific error classes with `toBeInstanceOf` instead of just checking that something threw'
  - 'Asserting MCP error codes from `MCP_ERROR_CODES` constants'
  - 'Validating the JSON-RPC error shape returned by `toJsonRpcError()`'
  - 'Testing both success and failure paths in the same suite'
---

# Testing Tool Error Handling and Error Classes

Test that a tool throws the correct MCP error classes with proper error codes and JSON-RPC error shapes.

## Code

```typescript
// src/tools/__tests__/lookup.tool.spec.ts
import { ToolContext } from '@frontmcp/sdk';
import { ResourceNotFoundError, MCP_ERROR_CODES } from '@frontmcp/sdk';
import { LookupTool } from '../lookup.tool';

describe('LookupTool error handling', () => {
  let tool: LookupTool;

  beforeEach(() => {
    tool = new LookupTool();

    const ctx = {
      get: jest.fn(),
      tryGet: jest.fn(),
      fail: jest.fn((err) => {
        throw err;
      }),
      mark: jest.fn(),
      notify: jest.fn(),
      respondProgress: jest.fn(),
    } as unknown as ToolContext;

    Object.assign(tool, ctx);
  });

  it('should throw ResourceNotFoundError for missing resource', async () => {
    await expect(tool.execute({ id: 'nonexistent' })).rejects.toThrow(ResourceNotFoundError);
  });

  it('should produce correct MCP error code', async () => {
    try {
      await tool.execute({ id: 'nonexistent' });
      fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ResourceNotFoundError);
      expect((err as ResourceNotFoundError).mcpErrorCode).toBe(MCP_ERROR_CODES.RESOURCE_NOT_FOUND);
    }
  });

  it('should produce valid JSON-RPC error shape', async () => {
    try {
      await tool.execute({ id: 'nonexistent' });
      fail('Expected an error to be thrown');
    } catch (err) {
      const rpc = (err as ResourceNotFoundError).toJsonRpcError();
      expect(rpc).toEqual({
        code: -32002,
        message: expect.any(String),
        data: expect.objectContaining({ uri: expect.any(String) }),
      });
    }
  });

  it('should succeed for valid resource id', async () => {
    const result = await tool.execute({ id: 'existing-123' });
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });
});
```

## What This Demonstrates

- Verifying specific error classes with `toBeInstanceOf` instead of just checking that something threw
- Asserting MCP error codes from `MCP_ERROR_CODES` constants
- Validating the JSON-RPC error shape returned by `toJsonRpcError()`
- Testing both success and failure paths in the same suite

## Related

- See `test-tool-unit` for the full tool unit testing reference
- See `setup-testing` for error class testing patterns
