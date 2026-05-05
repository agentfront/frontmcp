---
name: test-direct-client
description: In-memory testing with create() and connectOpenAI/connectClaude without HTTP overhead
---

# Testing with Direct Client (No HTTP)

Use `create()` for an in-memory `DirectMcpServer` and `connectOpenAI()` / `connectClaude()` for an in-memory `DirectClient` with platform-specific tool formatting. None of these start an HTTP server — they wire client and server through an in-memory transport.

Real API references:

- `create(config)` — `libs/sdk/src/direct/create.ts`. Returns `DirectMcpServer` with `listTools`, `callTool`, `listResources`, `readResource`, `listPrompts`, `getPrompt`, `dispose`.
- `connectOpenAI(config, options?)` / `connectClaude(config, options?)` — `libs/sdk/src/direct/connect.ts:159` / `:200`. Both take a `FrontMcpConfigInput` (decorated `@FrontMcp` class or config object) and return a `DirectClient`. There is no `serve` field; the in-memory transport is always used.
- Tools are class-based using the `@Tool` decorator (`libs/sdk/src/index.ts` — there is no `tool()` factory function).

```typescript
// direct-client.spec.ts
import { App, connectOpenAI, create, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'add',
  description: 'Add numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: { sum: z.number() },
})
class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return { sum: input.a + input.b };
  }
}

@App({ name: 'test-app', tools: [AddTool] })
class TestApp {}

@FrontMcp({ info: { name: 'test', version: '1.0.0' }, apps: [TestApp] })
class TestServerConfig {}

describe('Direct Client Testing', () => {
  it('calls tools via create() with a flat config', async () => {
    const server = await create({
      info: { name: 'test', version: '1.0.0' },
      tools: [AddTool],
      cacheKey: 'test-direct',
    });

    const result = await server.callTool('add', { a: 2, b: 3 });
    // execute() returns { sum: 5 }; the framework wraps it as a CallToolResult.
    expect(result.structuredContent).toEqual({ sum: 5 });

    await server.dispose();
  });

  it('returns OpenAI-formatted tools', async () => {
    const client = await connectOpenAI(TestServerConfig);

    const tools = await client.listTools();
    // OpenAI format: [{ type: 'function', function: { name, parameters } }]
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('add');

    await client.close();
  });

  it('returns Claude-formatted tools', async () => {
    const { connectClaude } = await import('@frontmcp/sdk');
    const client = await connectClaude(TestServerConfig);

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
