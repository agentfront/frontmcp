---
name: cli-scaffold-with-flags
reference: setup-project
level: basic
description: 'Use the `frontmcp create` CLI to scaffold a complete project non-interactively with explicit flags for deployment target, Redis, and package manager.'
tags: [setup, redis, cli, nx, scaffold, flags]
features:
  - 'Non-interactive scaffolding with `--yes` to accept all defaults'
  - 'Explicit `--target`, `--redis`, `--pm`, `--skills`, and `--cicd` flags'
  - 'Nx monorepo scaffolding with `--nx`'
  - 'Verifying the server responds to MCP `initialize` requests after startup'
---

# CLI Scaffold with Non-Interactive Flags

Use the `frontmcp create` CLI to scaffold a complete project non-interactively with explicit flags for deployment target, Redis, and package manager.

## Code

```bash
# Scaffold a Node.js server with Docker Redis and yarn
npx frontmcp create my-api \
  --target node \
  --redis docker \
  --pm yarn \
  --skills recommended \
  --cicd \
  --yes
```

```bash
# Scaffold a Vercel serverless project with no Redis
npx frontmcp create my-vercel-app \
  --target vercel \
  --redis none \
  --pm npm \
  --skills minimal \
  --no-cicd \
  --yes
```

```bash
# Scaffold an Nx monorepo workspace
npx frontmcp create my-workspace \
  --nx \
  --target node \
  --redis docker \
  --pm yarn \
  --yes
```

After scaffolding, start the development server:

```bash
cd my-api
yarn install
yarn dev
```

Test the server with an MCP initialize request:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'
```

## What This Demonstrates

- Non-interactive scaffolding with `--yes` to accept all defaults
- Explicit `--target`, `--redis`, `--pm`, `--skills`, and `--cicd` flags
- Nx monorepo scaffolding with `--nx`
- Verifying the server responds to MCP `initialize` requests after startup

## Related

- See `setup-project` for the full list of CLI flags and manual setup instructions
