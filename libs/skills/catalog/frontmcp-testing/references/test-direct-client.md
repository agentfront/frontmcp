---
name: test-direct-client
description: In-memory testing with create() and connectOpenAI/connectClaude without HTTP overhead
---

# Testing with Direct Client (No HTTP)

Uses `connect()` or `create()` for in-memory testing without HTTP overhead.

```typescript
import { create, connectOpenAI } from '@frontmcp/sdk';
import { tool } from '@frontmcp/sdk';
import { z } from 'zod';

const AddTool = tool({
  name: 'add',
  description: 'Add numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: { sum: z.number() },
})((input) => ({ sum: input.a + input.b }));

describe('Direct Client Testing', () => {
  it('should call tools via create()', async () => {
    const server = await create({
      info: { name: 'test', version: '1.0.0' },
      tools: [AddTool],
      cacheKey: 'test-direct',
    });

    const result = await server.callTool('add', { a: 2, b: 3 });
    expect(result.content[0].text).toContain('5');

    await server.dispose();
  });

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

    await client.close();
  });

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

## Examples

| Example                                                                                    | Level        | Description                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [`basic-create-test`](../examples/test-direct-client/basic-create-test.md)                 | Basic        | Test tools in-memory without any HTTP overhead using the `create()` function from `@frontmcp/sdk`.                            |
| [`openai-claude-format-test`](../examples/test-direct-client/openai-claude-format-test.md) | Intermediate | Verify that tools are returned in the correct format for OpenAI and Claude clients using `connectOpenAI` and `connectClaude`. |

> See all examples in [`examples/test-direct-client/`](../examples/test-direct-client/)
