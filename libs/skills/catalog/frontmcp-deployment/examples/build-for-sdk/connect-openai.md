---
name: connect-openai
reference: build-for-sdk
level: intermediate
description: "Use `connectOpenAI()` to get tools formatted for OpenAI's function-calling API."
tags: [deployment, sdk, openai, session, connect]
features:
  - 'Setting `serve: false` to prevent the HTTP server from starting in library mode'
  - 'Using `connectOpenAI()` to get tools in OpenAI function-calling format automatically'
  - 'Passing session information via `ConnectOptions` for user context'
---

# Connect to OpenAI Function Calling

Use `connectOpenAI()` to get tools formatted for OpenAI's function-calling API.

## Code

```typescript
// src/openai-integration.ts
import { App, connectOpenAI, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'search_docs',
  description: 'Search documentation by keyword',
  inputSchema: { query: z.string(), limit: z.number().optional() },
})
class SearchDocsTool extends ToolContext<{ query: string; limit?: number }> {
  async execute(input: { query: string; limit?: number }) {
    return {
      content: [{ type: 'text' as const, text: `Found results for: ${input.query}` }],
    };
  }
}

@App({ name: 'DocsApp', tools: [SearchDocsTool] })
class DocsApp {}

@FrontMcp({
  info: { name: 'docs-sdk', version: '1.0.0' },
  apps: [DocsApp],
  serve: false, // No HTTP server - library mode only
})
class DocsSDK {}

// Connect with OpenAI-formatted tools
async function main() {
  const client = await connectOpenAI(DocsSDK, {
    session: { id: 'user-123', user: { sub: 'user-id' } },
  });

  // Tools are returned in OpenAI format:
  // [{ type: 'function', function: { name, description, parameters, strict: true } }]
  const tools = await client.listTools();
  console.log(JSON.stringify(tools, null, 2));

  // Call a tool
  const result = await client.callTool('search_docs', { query: 'authentication' });
  console.log(result);

  // Always clean up
  await client.close();
}

main();
```

## What This Demonstrates

- Setting `serve: false` to prevent the HTTP server from starting in library mode
- Using `connectOpenAI()` to get tools in OpenAI function-calling format automatically
- Passing session information via `ConnectOptions` for user context

## Related

- See `build-for-sdk` for `connectClaude()`, `connectLangChain()`, and `connectVercelAI()` alternatives
