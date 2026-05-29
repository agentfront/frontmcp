---
name: 21-tool-with-availability-constraints
level: advanced
description: 'Three tools showing the `availableWhen` axes — macOS-only OS gate, production+Node runtime gate, and a `surface` gate that allows agent + job invocation but blocks direct MCP-client calls.'
tags: [availableWhen, os, runtime, surface, EntryUnavailableError]
features:
  - "Restricting a tool to macOS with `availableWhen: { os: ['darwin'] }`"
  - "Composing constraints — `runtime: ['node']` AND `env: ['production']` — both must match for the tool to be available"
  - 'Using the `surface` axis to expose an internal tool to agents and jobs while hiding it from direct user invocation'
  - 'Knowing what happens on mismatch — `EntryUnavailableError` (`-32099`) with `data.missingAxes` so clients show the right "not available here" reason'
---

# Tool With Availability Constraints

Three tools showing the `availableWhen` axes — macOS-only OS gate, production+Node runtime gate, and a `surface` gate that allows agent + job invocation but blocks direct MCP-client calls.

`availableWhen` is a hard registry-level constraint. Tools that don't match are filtered out of `tools/list` AND blocked from execution. Three real-world axes:

## Code

```typescript
// src/apps/main/tools/availability.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

// 1. macOS-only — uses Apple-specific APIs
@Tool({
  name: 'apple_notes_search',
  description: 'Search Apple Notes via the native bridge',
  inputSchema: { query: z.string() },
  outputSchema: { notes: z.array(z.object({ id: z.string(), title: z.string() })) },
  availableWhen: { os: ['darwin'] },
})
export class AppleNotesSearchTool extends ToolContext {
  async execute(_input: { query: string }) {
    return { notes: [] };
  }
}

// 2. Production-only AND Node runtime — uses production-specific deploy infra
@Tool({
  name: 'deploy_to_production',
  description: 'Deploy a service to production',
  inputSchema: { service: z.string(), version: z.string() },
  outputSchema: { deploymentId: z.string() },
  availableWhen: { runtime: ['node'], env: ['production'] },
  annotations: { destructiveHint: true, idempotentHint: false },
})
export class DeployToProductionTool extends ToolContext {
  async execute(_input: { service: string; version: string }) {
    return { deploymentId: 'd_42' };
  }
}

// 3. Agent / job only — internal tool, blocked from direct MCP client invocation
@Tool({
  name: 'rotate_secrets',
  description: 'Rotate the application signing keys',
  inputSchema: {},
  outputSchema: { rotated: z.boolean() },
  availableWhen: { surface: ['agent', 'job'] }, // not 'mcp' — chat UIs can't call this directly
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
})
export class RotateSecretsTool extends ToolContext {
  async execute() {
    return { rotated: true };
  }
}
```

## What This Demonstrates

- Restricting a tool to macOS with `availableWhen: { os: ['darwin'] }`
- Composing constraints — `runtime: ['node']` AND `env: ['production']` — both must match for the tool to be available
- Using the `surface` axis to expose an internal tool to agents and jobs while hiding it from direct user invocation
- Knowing what happens on mismatch — `EntryUnavailableError` (`-32099`) with `data.missingAxes` so clients show the right "not available here" reason

## Axes (recap)

| Axis         | Values                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `os`         | `'darwin'`, `'linux'`, `'win32'`                                                                |
| `runtime`    | `'node'`, `'browser'`, `'edge'`, `'bun'`, `'deno'`                                              |
| `deployment` | `'serverless'`, `'standalone'`, `'distributed'`, `'browser'`                                    |
| `provider`   | `'bare'`, `'docker'`, `'vercel'`, `'lambda'`, `'cloudflare'`, …                                 |
| `target`     | `'cli'`, `'node'`, `'vercel'`, `'lambda'`, `'cloudflare'`, … (set by `frontmcp build --target`) |
| `surface`    | `'mcp'`, `'cli'`, `'agent'`, `'job'`, `'http-trigger'` — per-call axis                          |
| `env`        | `'production'`, `'development'`, `'test'`                                                       |

Multiple axes are AND-ed. Multiple values within an axis are OR-ed.

## Why declarative beats imperative checks

```typescript
// ❌ imperative — tool still appears in tools/list everywhere; users see "this won't work here" only at call time
async execute(input) {
  if (!this.isPlatform('darwin')) this.fail(new PublicMcpError('macOS only'));
  // …
}

// ✅ declarative — tool is filtered out of tools/list on non-macOS servers; users never see it
@Tool({
  availableWhen: { os: ['darwin'] },
  // …
})
```

The declarative form removes the tool from `tools/list` on non-matching servers — AI clients won't propose using it. Imperative checks leak the tool's existence to users who can't use it.
