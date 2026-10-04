---
name: unit-test-tool-resource-prompt
reference: setup-testing
level: intermediate
description: 'Write unit tests for the three core MCP primitives, verifying that outputs match the expected MCP response shapes.'
tags: [testing, jest, unit-test, setup, unit, tool]
features:
  - 'Testing tool `execute()` on an instance from `Object.create(MyTool.prototype)`, with mock context methods assigned via `Object.assign`'
  - 'Verifying resource `execute(uri, params)` output matches the MCP `ReadResourceResult` shape'
  - 'Verifying prompt `execute()` output matches the MCP `GetPromptResult` shape'
  - 'Using Jest matchers like `expect.stringContaining` and `expect.objectContaining` for flexible assertions'
---

# Unit Testing Tools, Resources, and Prompts

Write unit tests for the three core MCP primitives, verifying that outputs match the expected MCP response shapes.

## Code

```typescript
// src/tools/__tests__/my-tool.spec.ts
import { MyTool } from '../my-tool';

describe('MyTool', () => {
  let tool: MyTool;

  beforeEach(() => {
    // `new MyTool()` throws: the constructor needs the request context the server builds.
    tool = Object.create(MyTool.prototype);
  });

  it('should return formatted result for valid input', async () => {
    const mockContext = {
      get: jest.fn(),
      tryGet: jest.fn(),
      fail: jest.fn(),
      mark: jest.fn(),
      fetch: jest.fn(),
    };
    Object.assign(tool, mockContext);

    const result = await tool.execute({ query: 'test input' });

    expect(result).toEqual({
      content: [{ type: 'text', text: expect.stringContaining('test input') }],
    });
  });

  it('should throw for invalid input', async () => {
    const mockContext = {
      get: jest.fn(),
      tryGet: jest.fn(),
      fail: jest.fn(),
    };
    Object.assign(tool, mockContext);

    await expect(tool.execute({ query: '' })).rejects.toThrow();
  });
});
```

```typescript
// src/resources/__tests__/my-resource.spec.ts
import { MyResource } from '../my-resource';

describe('MyResource', () => {
  it('should return resource contents matching ReadResourceResult', async () => {
    const resource: MyResource = Object.create(MyResource.prototype);
    const result = await resource.execute('resource://item/123', { id: '123' });

    expect(result).toEqual({
      contents: [
        {
          uri: expect.stringMatching(/^resource:\/\//),
          mimeType: 'application/json',
          text: expect.any(String),
        },
      ],
    });
  });
});
```

```typescript
// src/prompts/__tests__/my-prompt.spec.ts
import { MyPrompt } from '../my-prompt';

describe('MyPrompt', () => {
  it('should return a valid GetPromptResult', async () => {
    const prompt: MyPrompt = Object.create(MyPrompt.prototype);
    const result = await prompt.execute({ topic: 'testing' });

    expect(result).toEqual({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.objectContaining({ type: 'text' }),
        }),
      ]),
    });
  });
});
```

## What This Demonstrates

- Testing tool `execute()` on an instance from `Object.create(MyTool.prototype)`, with mock context methods assigned via `Object.assign`
- Verifying resource `execute(uri, params)` output matches the MCP `ReadResourceResult` shape
- Verifying prompt `execute()` output matches the MCP `GetPromptResult` shape
- Using Jest matchers like `expect.stringContaining` and `expect.objectContaining` for flexible assertions

## Related

- See `setup-testing` for the full testing setup reference
- See `test-tool-unit` for detailed tool unit testing patterns
