---
name: mcpb-bundle-build
reference: build-for-mcpb
level: basic
description: 'Produce a .mcpb archive for Claude Desktop with metadata, tools, and install-time user_config.'
tags: [deployment, mcpb, bundle, claude-desktop, user-config]
features:
  - 'Using `frontmcp build --target mcpb` to produce a single `.mcpb` archive'
  - 'Passing `setup.steps` and `userConfig` answers to the server as env vars via `${user_config.KEY}`'
  - 'Validating the archive round-trip with `frontmcp mcpb validate`'
---

# MCPB Bundle Build

Produce a .mcpb archive for Claude Desktop with metadata, tools, and install-time user_config.

## Code

```typescript
// src/main.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'greet',
  description: 'Greet a user by name',
  inputSchema: { name: z.string() },
})
class GreetTool extends ToolContext {
  async execute(input: { name: string }) {
    const apiBase = process.env.API_BASE ?? 'https://api.example.com';
    const greeting = process.env.GREETING ?? 'Hello';
    return {
      content: [{ type: 'text' as const, text: `${greeting}, ${input.name}! (via ${apiBase})` }],
    };
  }
}

@App({ name: 'GreeterApp', tools: [GreetTool] })
class GreeterApp {}

@FrontMcp({
  info: { name: 'greeter-mcpb', version: '1.0.0' },
  apps: [GreeterApp],
})
export default class GreeterServer {}
```

```js
// frontmcp.config.js
const { z } = require('zod');

module.exports = {
  name: 'greeter-mcpb',
  version: '1.0.0',
  entry: './src/main.ts',
  nodeVersion: '>=22.0.0',
  deployments: [
    {
      target: 'mcpb',
      displayName: 'Greeter',
      longDescription: '# Greeter\n\nSays hi to the configured API.',
      author: { name: 'Acme', email: 'hello@acme.dev' },
      license: 'Apache-2.0',
      homepage: 'https://acme.dev/greeter',
      repository: 'https://github.com/acme/greeter',
      icon: 'assets/icon.png',
      keywords: ['greeting', 'demo'],
      compatibility: {
        claude_desktop: '>=1.0.0',
        platforms: ['darwin', 'linux', 'win32'],
        runtimes: { node: '>=22.0.0' },
      },
      sea: { enabled: true },
      // Each entry reaches the server as an env var: `env`, else the key in UPPER_SNAKE_CASE.
      userConfig: {
        greeting: { type: 'string', title: 'Greeting word', default: 'Hello' }, // → GREETING
      },
      // Merged into mcp_config.env too; a user_config answer wins over it.
      env: { LOG_FORMAT: 'json' },
    },
  ],
  // Install-time questions — each step becomes a user_config entry + env var.
  setup: {
    steps: [
      {
        id: 'api-base',
        prompt: 'API Base URL',
        description: 'Endpoint the greeter should call',
        env: 'API_BASE',
        schema: z.string().url().default('https://api.example.com'),
      },
      {
        id: 'api-token',
        prompt: 'API Token',
        description: 'Personal access token for the API',
        env: 'API_TOKEN',
        sensitive: true,
        schema: z.string().min(1),
      },
    ],
  },
};
```

```bash
# Build — produces dist/mcpb/greeter-mcpb-1.0.0.mcpb
frontmcp build --target mcpb

# Validate the archive
frontmcp mcpb validate dist/mcpb/greeter-mcpb-1.0.0.mcpb

# Open in Claude Desktop to install
open dist/mcpb/greeter-mcpb-1.0.0.mcpb
```

The generated `manifest.json` wires every answer to the server:

```json
"mcp_config": {
  "command": "node",
  "args": ["${__dirname}/server/index.js"],
  "env": {
    "LOG_FORMAT": "json",
    "API_BASE": "${user_config.apiBase}",
    "API_TOKEN": "${user_config.apiToken}",
    "GREETING": "${user_config.greeting}",
    "FRONTMCP_STDIO": "1"
  }
}
```

## What This Demonstrates

- Using `frontmcp build --target mcpb` to produce a single `.mcpb` archive
- Passing `setup.steps` and `userConfig` answers to the server as env vars via `${user_config.KEY}`
- Validating the archive round-trip with `frontmcp mcpb validate`

## Related

- See `build-for-mcpb` for the full manifest reference, user_config type resolution, SEA binary packaging, and cross-platform `--merge-from` workflow.
