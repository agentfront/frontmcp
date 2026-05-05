---
name: openai-claude-format-test
reference: test-direct-client
level: intermediate
description: 'Verify that tools are returned in the correct format for OpenAI and Claude clients using `connectOpenAI` and `connectClaude`.'
tags: [testing, openai, anthropic, direct-client]
features:
  - 'Using `connectOpenAI(ServerConfig)` to get an in-memory `DirectClient` (no HTTP server is started)'
  - "Verifying OpenAI tool format: `{ type: 'function', function: { name, parameters } }`"
  - 'Using `connectClaude(ServerConfig)` to verify Claude format: `{ name, description, input_schema }`'
  - 'Proper cleanup with `client.close()` after each test'
---

# Testing OpenAI and Claude Tool Formats

Verify that tools are returned in the correct format for OpenAI and Claude clients using `connectOpenAI` and `connectClaude`.

## Code

```typescript
// src/__tests__/client-formats.spec.ts
// Real API:
//   libs/sdk/src/direct/connect.ts:159 — `connectOpenAI(config, options?)` (no `serve` field)
//   libs/sdk/src/direct/connect.ts:200 — `connectClaude(config, options?)`
//   libs/sdk/src/index.ts — exports `Tool`, `ToolContext`, `App`, `FrontMcp`, `z`
import { App, connectClaude, connectOpenAI, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

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

describe('OpenAI format', () => {
  it('returns OpenAI-formatted tools', async () => {
    const client = await connectOpenAI(TestServerConfig);

    const tools = await client.listTools();
    // OpenAI format: [{ type: 'function', function: { name, parameters } }]
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('add');
    expect(tools[0].function.parameters).toBeDefined();

    await client.close();
  });
});

describe('Claude format', () => {
  it('returns Claude-formatted tools', async () => {
    const client = await connectClaude(TestServerConfig);

    const tools = await client.listTools();
    // Claude format: [{ name, description, input_schema }]
    expect(tools[0].name).toBe('add');
    expect(tools[0].input_schema).toBeDefined();

    await client.close();
  });
});
```

## What This Demonstrates

- Using `connectOpenAI(ServerConfig)` to get an in-memory `DirectClient` (no HTTP server is started)
- Verifying OpenAI tool format: `{ type: 'function', function: { name, parameters } }`
- Using `connectClaude(ServerConfig)` to verify Claude format: `{ name, description, input_schema }`
- Proper cleanup with `client.close()` after each test

## Related

- See `test-direct-client` for the full direct client testing reference
