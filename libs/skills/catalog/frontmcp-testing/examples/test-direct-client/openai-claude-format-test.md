---
name: openai-claude-format-test
reference: test-direct-client
level: intermediate
description: 'Verify that tools are returned in the correct format for OpenAI and Claude clients using `connectOpenAI` and `connectClaude`.'
tags: [testing, openai, anthropic, direct-client, direct, client]
features:
  - 'Using `connectOpenAI()` with `serve: false` to get an in-memory client without starting an HTTP server'
  - "Verifying OpenAI tool format: `{ type: 'function', function: { name, parameters } }`"
  - 'Using dynamic import for `connectClaude` to test Claude tool format: `{ name, description, input_schema }`'
  - 'Proper cleanup with `client.close()` after each test'
---

# Testing OpenAI and Claude Tool Formats

Verify that tools are returned in the correct format for OpenAI and Claude clients using `connectOpenAI` and `connectClaude`.

## Code

```typescript
// src/__tests__/client-formats.spec.ts
import { connectOpenAI, tool, z } from '@frontmcp/sdk';

const AddTool = tool({
  name: 'add',
  description: 'Add numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: { sum: z.number() },
})((input) => ({ sum: input.a + input.b }));

describe('OpenAI format', () => {
  it('should return OpenAI-formatted tools', async () => {
    const client = await connectOpenAI({
      info: { name: 'test', version: '1.0.0' },
      tools: [AddTool],
      serve: false,
    });

    const tools = await client.listTools();
    // OpenAI format: [{ type: 'function', function: { name, parameters } }]
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('add');
    expect(tools[0].function.parameters).toBeDefined();

    await client.close();
  });
});

describe('Claude format', () => {
  it('should return Claude-formatted tools', async () => {
    const { connectClaude } = await import('@frontmcp/sdk');
    const client = await connectClaude({
      info: { name: 'test', version: '1.0.0' },
      tools: [AddTool],
      serve: false,
    });

    const tools = await client.listTools();
    // Claude format: [{ name, description, input_schema }]
    expect(tools[0].name).toBe('add');
    expect(tools[0].input_schema).toBeDefined();

    await client.close();
  });
});
```

## What This Demonstrates

- Using `connectOpenAI()` with `serve: false` to get an in-memory client without starting an HTTP server
- Verifying OpenAI tool format: `{ type: 'function', function: { name, parameters } }`
- Using dynamic import for `connectClaude` to test Claude tool format: `{ name, description, input_schema }`
- Proper cleanup with `client.close()` after each test

## Related

- See `test-direct-client` for the full direct client testing reference
