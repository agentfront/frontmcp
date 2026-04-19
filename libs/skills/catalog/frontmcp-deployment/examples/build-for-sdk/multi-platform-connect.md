---
name: multi-platform-connect
reference: build-for-sdk
level: advanced
description: 'Connect the same FrontMCP server to multiple LLM platforms using platform-specific `connect*()` functions.'
tags: [deployment, sdk, multi, platform, connect]
features:
  - 'Connecting a single FrontMCP server to four different LLM platforms with automatic schema translation'
  - "Each `connect*()` function returns tools in the platform's native format"
  - 'All clients share the same `DirectClient` API (`listTools`, `callTool`, `close`)'
---

# Multi-Platform Tool Connection

Connect the same FrontMCP server to multiple LLM platforms using platform-specific `connect*()` functions.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'translate',
  description: 'Translate text to a target language',
  inputSchema: { text: z.string(), targetLang: z.string() },
})
class TranslateTool extends ToolContext<{ text: string; targetLang: string }> {
  async execute(input: { text: string; targetLang: string }) {
    return {
      content: [{ type: 'text' as const, text: `[${input.targetLang}] ${input.text}` }],
    };
  }
}

@App({ name: 'TranslateApp', tools: [TranslateTool] })
class TranslateApp {}

@FrontMcp({
  info: { name: 'translate-sdk', version: '1.0.0' },
  apps: [TranslateApp],
  serve: false,
})
class TranslateSDK {}

export default TranslateSDK;
```

```typescript
// src/connect-all-platforms.ts
import { connectClaude, connectLangChain, connectOpenAI, connectVercelAI } from '@frontmcp/sdk';

import TranslateSDK from './server';

async function main() {
  // OpenAI format: [{ type: 'function', function: { name, description, parameters, strict: true } }]
  const openaiClient = await connectOpenAI(TranslateSDK, {
    clientInfo: { name: 'my-app', version: '1.0' },
    session: { id: 'session-1', user: { sub: 'user-1', name: 'Alice' } },
  });
  const openaiTools = await openaiClient.listTools();
  console.log('OpenAI tools:', openaiTools);

  // Claude format: [{ name, description, input_schema }]
  const claudeClient = await connectClaude(TranslateSDK);
  const claudeTools = await claudeClient.listTools();
  console.log('Claude tools:', claudeTools);

  // LangChain tool schema format
  const langchainClient = await connectLangChain(TranslateSDK);
  const langchainTools = await langchainClient.listTools();
  console.log('LangChain tools:', langchainTools);

  // Vercel AI SDK format
  const vercelClient = await connectVercelAI(TranslateSDK);
  const vercelTools = await vercelClient.listTools();
  console.log('Vercel AI tools:', vercelTools);

  // All clients share the same DirectClient API
  const result = await openaiClient.callTool('translate', {
    text: 'Hello',
    targetLang: 'es',
  });
  console.log(result);

  // Clean up all clients
  await openaiClient.close();
  await claudeClient.close();
  await langchainClient.close();
  await vercelClient.close();
}

main();
```

## What This Demonstrates

- Connecting a single FrontMCP server to four different LLM platforms with automatic schema translation
- Each `connect*()` function returns tools in the platform's native format
- All clients share the same `DirectClient` API (`listTools`, `callTool`, `close`)

## Related

- See `build-for-sdk` for the full `DirectClient` API reference and `ConnectOptions` details
