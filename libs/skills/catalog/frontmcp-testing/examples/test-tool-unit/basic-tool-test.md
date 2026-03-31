---
name: basic-tool-test
reference: test-tool-unit
level: basic
description: "Test a simple tool's `execute()` method with mock context and verify the output."
tags: [testing, tool, unit]
features:
  - 'Creating a mock `ToolContext` with all required methods (`get`, `tryGet`, `fail`, `mark`, `notify`, `respondProgress`)'
  - 'Assigning the mock context to the tool instance via `Object.assign`'
  - 'Testing multiple input scenarios including edge cases (negatives, zero)'
---

# Basic Tool Unit Test

Test a simple tool's `execute()` method with mock context and verify the output.

## Code

```typescript
// src/tools/__tests__/add.tool.spec.ts
import { ToolContext } from '@frontmcp/sdk';
import { AddTool } from '../add.tool';

describe('AddTool', () => {
  let tool: AddTool;

  beforeEach(() => {
    tool = new AddTool();

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

  it('should add two numbers', async () => {
    const result = await tool.execute({ a: 2, b: 3 });
    expect(result).toEqual({ sum: 5 });
  });

  it('should handle negative numbers', async () => {
    const result = await tool.execute({ a: -1, b: -2 });
    expect(result).toEqual({ sum: -3 });
  });

  it('should handle zero values', async () => {
    const result = await tool.execute({ a: 0, b: 0 });
    expect(result).toEqual({ sum: 0 });
  });
});
```

## What This Demonstrates

- Creating a mock `ToolContext` with all required methods (`get`, `tryGet`, `fail`, `mark`, `notify`, `respondProgress`)
- Assigning the mock context to the tool instance via `Object.assign`
- Testing multiple input scenarios including edge cases (negatives, zero)

## Related

- See `test-tool-unit` for the full tool unit testing reference
