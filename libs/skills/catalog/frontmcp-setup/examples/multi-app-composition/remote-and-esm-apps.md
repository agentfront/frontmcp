---
name: remote-and-esm-apps
reference: multi-app-composition
level: intermediate
description: 'Compose local, ESM (npm package), and remote (external MCP server) apps into a single gateway.'
tags: [setup, oauth, auth, transport, multi-app, remote]
features:
  - '`app.esm()` loads an `@App` class from an npm package with namespace and auto-update'
  - '`app.remote()` proxies tools from external MCP servers with configurable auth modes'
  - "`remoteAuth` supports `'static'` (fixed credentials), `'forward'` (pass gateway user token), and `'oauth'`"
  - '`namespace` prevents tool name collisions between apps (`crm:tool_name`, `slack:tool_name`)'
  - '`transportOptions` configure timeout, retries, and SSE fallback for remote connections'
---

# Remote and ESM App Composition

Compose local, ESM (npm package), and remote (external MCP server) apps into a single gateway.

## Code

```typescript
// src/main.ts
import 'reflect-metadata';
import { FrontMcp, App, app } from '@frontmcp/sdk';

@App({
  id: 'local',
  name: 'Local Tools',
  tools: [EchoTool],
})
class LocalApp {}

@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [
    // Local app
    LocalApp,

    // ESM app from npm package
    app.esm('@acme/crm-tools@^2.0.0', {
      namespace: 'crm',
      autoUpdate: { enabled: true, intervalMs: 300_000 },
    }),

    // Remote MCP server with static auth
    app.remote('https://slack-mcp.example.com/mcp', {
      namespace: 'slack',
      remoteAuth: {
        mode: 'static',
        credentials: { type: 'bearer', value: process.env['SLACK_TOKEN']! },
      },
      transportOptions: {
        timeout: 30000,
        retryAttempts: 3,
        fallbackToSSE: true,
      },
    }),

    // Remote MCP server with forwarded auth
    app.remote('https://api.internal.com/mcp', {
      namespace: 'api',
      remoteAuth: {
        mode: 'forward',
      },
    }),
  ],
})
export default class Server {}
```

## What This Demonstrates

- `app.esm()` loads an `@App` class from an npm package with namespace and auto-update
- `app.remote()` proxies tools from external MCP servers with configurable auth modes
- `remoteAuth` supports `'static'` (fixed credentials), `'forward'` (pass gateway user token), and `'oauth'`
- `namespace` prevents tool name collisions between apps (`crm:tool_name`, `slack:tool_name`)
- `transportOptions` configure timeout, retries, and SSE fallback for remote connections

## Related

- See `multi-app-composition` for scope isolation, per-app auth, and shared plugins
