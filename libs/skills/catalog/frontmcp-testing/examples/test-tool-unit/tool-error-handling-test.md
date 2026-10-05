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
import { MCP_ERROR_CODES, ResourceNotFoundError } from '@frontmcp/sdk';

import { LookupTool } from '../lookup.tool';

describe('LookupTool error handling', () => {
  let tool: LookupTool;

  beforeEach(() => {
    // `new LookupTool()` throws: the constructor needs the request context the server builds.
    tool = Object.create(LookupTool.prototype);

    // `fail` rethrows the error it gets, so the tests see the MCP error class (the real one throws a flow-control signal).
    Object.assign(tool, {
      get: jest.fn(),
      tryGet: jest.fn(),
      fail: jest.fn((error: Error) => {
        throw error;
      }),
      mark: jest.fn(),
      fetch: jest.fn(),
      notify: jest.fn(),
    });
  });

  it('should throw ResourceNotFoundError for missing resource', async () => {
    await expect(tool.execute({ id: 'nonexistent' })).rejects.toThrow(ResourceNotFoundError);
  });

  it('should produce correct MCP error code', async () => {
    await expect(tool.execute({ id: 'nonexistent' })).rejects.toMatchObject({
      mcpErrorCode: MCP_ERROR_CODES.RESOURCE_NOT_FOUND,
    });
  });

  it('should produce valid JSON-RPC error shape', async () => {
    // `.catch` turns the rejection into a value; a call that resolves fails the instanceof check below.
    const error = await tool.execute({ id: 'nonexistent' }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ResourceNotFoundError);
    expect((error as ResourceNotFoundError).toJsonRpcError()).toEqual({
      code: -32002,
      message: expect.any(String),
      data: expect.objectContaining({ uri: expect.any(String) }),
    });
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
