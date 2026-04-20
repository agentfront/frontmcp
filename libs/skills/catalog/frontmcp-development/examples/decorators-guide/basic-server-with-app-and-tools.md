---
name: basic-server-with-app-and-tools
reference: decorators-guide
level: basic
description: 'Demonstrates the minimal decorator hierarchy to create a working FrontMCP server with one app containing a tool and a resource.'
tags: [development, decorators, app, tools]
features:
  - 'The `@FrontMcp` -> `@App` -> `@Tool`/`@Resource`/`@Prompt` nesting hierarchy'
  - 'Tool classes extend `ToolContext` and implement `execute()`'
  - 'Resource classes extend `ResourceContext` and implement `read()`'
  - 'Prompt classes extend `PromptContext` and implement `execute()`'
  - 'Apps group related tools, resources, and prompts into logical modules'
---

# Basic Server with @FrontMcp, @App, and @Tool

Demonstrates the minimal decorator hierarchy to create a working FrontMCP server with one app containing a tool and a resource.

## Code

```typescript
// src/tools/search-users.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'search_users',
  description: 'Search for users by name or email',
  inputSchema: {
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(10),
  },
})
class SearchUsersTool extends ToolContext {
  async execute(input: { query: string; limit: number }) {
    const users = await this.get(UserService).search(input.query, input.limit);
    return { users };
  }
}
```

```typescript
// src/resources/app-config.resource.ts
import { Resource, ResourceContext } from '@frontmcp/sdk';

@Resource({
  name: 'app_config',
  uri: 'config://app/settings',
  description: 'Current application settings',
  mimeType: 'application/json',
})
class AppConfigResource extends ResourceContext {
  async read() {
    const config = await this.get(ConfigService).getAll();
    return { contents: [{ uri: this.uri, text: JSON.stringify(config) }] };
  }
}
```

```typescript
// src/prompts/code-review.prompt.ts
import { Prompt, PromptContext } from '@frontmcp/sdk';

@Prompt({
  name: 'code_review',
  description: 'Generate a code review for the given code',
  arguments: [
    { name: 'code', description: 'The code to review', required: true },
    { name: 'language', description: 'Programming language' },
  ],
})
class CodeReviewPrompt extends PromptContext {
  async execute(args: { code: string; language?: string }) {
    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Review this ${args.language ?? ''} code:\n\n${args.code}`,
          },
        },
      ],
    };
  }
}
```

```typescript
// src/server.ts
import { App, FrontMcp } from '@frontmcp/sdk';

import { CodeReviewPrompt } from './prompts/code-review.prompt';
import { AppConfigResource } from './resources/app-config.resource';
import { SearchUsersTool } from './tools/search-users.tool';

@App({
  name: 'analytics',
  tools: [SearchUsersTool],
  resources: [AppConfigResource],
  prompts: [CodeReviewPrompt],
})
class AnalyticsApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [AnalyticsApp],
  transport: 'modern',
  http: { port: 3000 },
})
class MyServer {}
```

## What This Demonstrates

- The `@FrontMcp` -> `@App` -> `@Tool`/`@Resource`/`@Prompt` nesting hierarchy
- Tool classes extend `ToolContext` and implement `execute()`
- Resource classes extend `ResourceContext` and implement `read()`
- Prompt classes extend `PromptContext` and implement `execute()`
- Apps group related tools, resources, and prompts into logical modules

## Related

- See `decorators-guide` for the full decorator reference including all field options
- See `create-tool` for step-by-step tool creation patterns
