---
name: basic-tool-test
reference: test-tool-unit
level: basic
description: "Test a simple tool's `execute()` method with mock context and verify the output."
tags: [testing, tool, unit]
features:
  - 'Creating the tool with `Object.create(AddTool.prototype)`, since its constructor needs the request context the server builds'
  - 'Assigning mocks of the context methods it calls (`get`, `tryGet`, `fail`, `mark`, `fetch`, `notify`) via `Object.assign`'
  - 'Testing multiple input scenarios including edge cases (negatives, zero)'
---

# Basic Tool Unit Test

Test a simple tool's `execute()` method with mock context and verify the output.

## Code

```typescript
// src/tools/__tests__/add.tool.spec.ts
// Real API: libs/sdk/src/common/interfaces/execution-context.interface.ts
//   ExecutionContextBase exposes: get, tryGet, fail, mark, fetch (and the getters scope, auth, context)
//   ToolContext additionally exposes: notify, progress (mock them only when the tool calls them)
import { AddTool } from '../add.tool';

describe('AddTool', () => {
  let tool: AddTool;

  beforeEach(() => {
    // `new AddTool()` throws: the constructor needs the request context the server builds.
    tool = Object.create(AddTool.prototype);

    // Getters such as `scope` and `auth` have no setter; stub them with Object.defineProperty.
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

- Creating the tool with `Object.create(AddTool.prototype)`, since its constructor needs the request context the server builds
- Assigning mocks of the context methods it calls (`get`, `tryGet`, `fail`, `mark`, `fetch`, `notify`) via `Object.assign`
- Testing multiple input scenarios including edge cases (negatives, zero)

## Related

- See `test-tool-unit` for the full tool unit testing reference
