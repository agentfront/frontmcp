---
name: test-tool-unit
description: Unit test a ToolContext execute method with mock context, inputs, and Zod schema validation
---

# Unit Testing a Tool

```typescript
import { ToolContext, z } from '@frontmcp/sdk';

import { AddTool } from '../tools/add.tool';

describe('AddTool', () => {
  it('should add two numbers', async () => {
    // Create mock context
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

    const tool = new AddTool();
    Object.assign(tool, ctx);

    const result = await tool.execute({ a: 2, b: 3 });
    expect(result).toEqual({ sum: 5 });
  });

  it('should handle negative numbers', async () => {
    const tool = new AddTool();
    const result = await tool.execute({ a: -1, b: -2 });
    expect(result).toEqual({ sum: -3 });
  });

  it('should throw on invalid input', async () => {
    const tool = new AddTool();
    // Zod validates before execute — test the schema separately
    const schema = z.object({ a: z.number(), b: z.number() });
    expect(() => schema.parse({ a: 'not-a-number' })).toThrow();
  });
});
```

## Examples

| Example                                                                              | Level        | Description                                                                                              |
| ------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------- |
| [`basic-tool-test`](../examples/test-tool-unit/basic-tool-test.md)                   | Basic        | Test a simple tool's `execute()` method with mock context and verify the output.                         |
| [`schema-validation-test`](../examples/test-tool-unit/schema-validation-test.md)     | Intermediate | Validate that a tool's Zod input schema rejects invalid data before `execute()` is called.               |
| [`tool-error-handling-test`](../examples/test-tool-unit/tool-error-handling-test.md) | Advanced     | Test that a tool throws the correct MCP error classes with proper error codes and JSON-RPC error shapes. |

> See all examples in [`examples/test-tool-unit/`](../examples/test-tool-unit/)
