---
name: setup-project
description: Scaffold a new FrontMCP project with CLI or manual setup, decorators, apps, and deployment config
---

# Scaffold and Configure a New FrontMCP Project

## When to Use This Skill

### Must Use

- Creating a brand-new FrontMCP MCP server project from scratch
- Setting up the `@FrontMcp` root decorator and `@App` structure for the first time
- Choosing and configuring a deployment target (Node, Vercel, Lambda, Cloudflare)

### Recommended

- Adding FrontMCP to an existing TypeScript codebase that has no MCP server yet
- Scaffolding a new app inside an Nx monorepo with `@frontmcp/nx` generators
- Setting up the dev-loop (`frontmcp dev`, build, env vars) for a fresh project

### Skip When

- The project already has a working `@FrontMcp`-decorated server -- use `create-tool`, `create-resource`, or `create-prompt` to add entries
- You only need to add Redis or SQLite storage to an existing server -- use `setup-redis` or `setup-sqlite`
- You need to configure deployment for an already-scaffolded project -- use `deploy-to-vercel`, `deploy-to-lambda`, or `deploy-to-cloudflare`

> **Decision:** Use this skill when no FrontMCP server exists yet and you need to scaffold the project structure, dependencies, and entry point from scratch.

## Step 1 -- Use the CLI Scaffolder (Preferred)

The `frontmcp` CLI generates a complete project structure. Run it with `npx`:

```bash
npx frontmcp create <projectName>
```

The CLI will interactively prompt for deployment target, Redis setup, package manager, CI/CD, and skills bundle. To skip prompts, pass flags directly:

```bash
npx frontmcp create <projectName> \
  --target <node|vercel|lambda|cloudflare> \
  --redis <docker|existing|none> \
  --pm <npm|yarn|pnpm> \
  --skills <recommended|minimal|full|none> \
  --cicd
```

All available flags:

| Flag                   | Values                                   | Default       | Description                                   |
| ---------------------- | ---------------------------------------- | ------------- | --------------------------------------------- |
| `--target`             | `node`, `vercel`, `lambda`, `cloudflare` | `node`        | Deployment target                             |
| `--redis`              | `docker`, `existing`, `none`             | prompted      | Redis provisioning strategy                   |
| `--pm`                 | `npm`, `yarn`, `pnpm`                    | prompted      | Package manager                               |
| `--skills`             | `recommended`, `minimal`, `full`, `none` | `recommended` | Skills bundle to install                      |
| `--cicd` / `--no-cicd` | boolean                                  | prompted      | Enable GitHub Actions CI/CD                   |
| `--nx`                 | boolean                                  | `false`       | Scaffold an Nx monorepo instead of standalone |
| `-y, --yes`            | boolean                                  | `false`       | Accept all defaults non-interactively         |

Add `--yes` to accept all defaults non-interactively:

```bash
npx frontmcp create my-server --yes
```

If the CLI scaffold succeeds, skip to Step 5 (environment variables). The CLI generates the full file tree including the server class, sample tools, Dockerfile, tsconfig, and build scripts.

## Step 2 -- Manual Setup (if CLI is not available or adding to an existing codebase)

If the CLI is not available or the project already exists, set up manually.

### 2a. Initialize the package

```bash
mkdir -p <projectName>/src
cd <projectName>
```

Create `package.json`:

```json
{
  "name": "<projectName>",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "frontmcp dev",
    "build": "frontmcp build",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "frontmcp": "latest",
    "@frontmcp/sdk": "latest",
    "reflect-metadata": "^0.2.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^22.0.0"
  }
}
```

### 2b. Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Critical: `experimentalDecorators` and `emitDecoratorMetadata` must both be `true`. FrontMCP uses TypeScript decorators (`@FrontMcp`, `@App`, `@Tool`, `@Resource`, `@Prompt`, `@Skill`).

### 2c. Install dependencies

```bash
yarn install   # or npm install / pnpm install
```

## Step 3 -- Create the Server Entry Point

Create `src/main.ts` with the `@FrontMcp` decorator. This is the root of every FrontMCP server.

The `@FrontMcp` decorator accepts a `FrontMcpMetadata` object with these fields:

```typescript
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  // Required fields
  info: {
    name: '<projectName>', // string (required) - server name in MCP initialize response
    version: '0.1.0', // string (required) - server version
    title: 'My Server', // string (optional) - display title
  },
  apps: [], // AppType[] (required) - array of @App classes or remote apps

  // Optional fields - include only what you need
  // http?: { port: number, host?: string, unixSocket?: string }
  // redis?: { provider: 'redis', host: string, port?: number, ... } | { provider: 'vercel-kv', ... }
  // sqlite?: { path: string, walMode?: boolean, encryption?: { secret: string } }
  // transport?: 'modern' | 'legacy' | 'stateless-api' | 'full' | { protocol?: ProtocolPreset, ... }
  // auth?: { mode: 'public' | 'transparent' | 'local' | 'remote', ... }
  // logging?: { level?: string, transports?: [...] }
  // plugins?: PluginType[]
  // providers?: ProviderType[]
  // tools?: ToolType[]         - shared tools available to all apps
  // resources?: ResourceType[] - shared resources available to all apps
  // skills?: SkillType[]       - shared skills available to all apps
  // skillsConfig?: { enabled: boolean, mcpTools?: boolean, cache?: {...}, auth?: 'api-key' | 'bearer' }
  // elicitation?: { enabled: boolean }
  // pubsub?: { provider: 'redis', host: string, ... }
  // pagination?: { ... }
  // jobs?: { enabled: boolean, store?: { redis?: {...} } }
  // throttle?: { enabled: boolean, global?: {...}, ... }
})
export default class Server {}
```

### Deployment-target-specific configuration

**Node (default):** No extra transport config needed. The SDK defaults to stdio + Streamable HTTP on port 3000.

```typescript
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: '<projectName>', version: '0.1.0' },
  apps: [],
  http: { port: 3000 },
})
export default class Server {}
```

**Vercel:** Set transport protocol and use Vercel KV for storage:

```typescript
@FrontMcp({
  info: { name: '<projectName>', version: '0.1.0' },
  apps: [],
  transport: { protocol: 'modern' }, // 'modern' preset enables streamable HTTP + strict sessions
  redis: { provider: 'vercel-kv' },
})
export default class Server {}
```

**Lambda / Cloudflare:** Use the `modern` transport preset. Session storage must be external (Redis).

```typescript
@FrontMcp({
  info: { name: '<projectName>', version: '0.1.0' },
  apps: [],
  transport: { protocol: 'modern' }, // 'modern' preset enables streamable HTTP + strict sessions
  redis: {
    provider: 'redis',
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
  },
})
export default class Server {}
```

## Step 4 -- Add an App with Tools, Resources, and Prompts

### 4a. Create a Tool

Create `src/tools/add.tool.ts`:

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: { result: z.number() },
})
export default class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return {
      result: input.a + input.b,
    };
  }
}
```

### 4b. Create an App to group entries

Create `src/apps/calc.app.ts`:

```typescript
import { App } from '@frontmcp/sdk';
import AddTool from '../tools/add.tool';

@App({
  id: 'calc', // string (optional) - unique identifier
  name: 'Calculator', // string (required) - display name
  tools: [AddTool], // ToolType[] (optional)
  // resources?: ResourceType[] // optional
  // prompts?: PromptType[]     // optional
  // agents?: AgentType[]       // optional
  // skills?: SkillType[]       // optional
  // plugins?: PluginType[]     // optional
  // providers?: ProviderType[] // optional
  // adapters?: AdapterType[]   // optional
  // auth?: AuthOptionsInput    // optional - per-app auth override
  // standalone?: boolean | 'includeInParent' // optional - default false
  // jobs?: JobType[]           // optional
  // workflows?: WorkflowType[] // optional
})
export class CalcApp {}
```

### 4c. Register the App in the server

Update `src/main.ts`:

```typescript
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';
import { CalcApp } from './apps/calc.app';

@FrontMcp({
  info: { name: '<projectName>', version: '0.1.0' },
  apps: [CalcApp],
})
export default class Server {}
```

### 4d. Additional entry types

Resources, Prompts, and Skills follow the same decorator pattern:

```typescript
// Resource - returns MCP ReadResourceResult
import { Resource, ResourceContext } from '@frontmcp/sdk';

@Resource({ uri: 'config://app', name: 'App Config', mimeType: 'application/json' })
export default class AppConfigResource extends ResourceContext {
  /* ... */
}

// Prompt - returns MCP GetPromptResult
import { Prompt, PromptContext } from '@frontmcp/sdk';

@Prompt({ name: 'summarize', description: 'Summarize a document' })
export default class SummarizePrompt extends PromptContext {
  /* ... */
}

// Skill - compound capability with tools + instructions
import { Skill, SkillContext } from '@frontmcp/sdk';

@Skill({ name: 'data-analysis', description: 'Analyze datasets' })
export default class DataAnalysisSkill extends SkillContext {
  /* ... */
}
```

Register them in the `@App` decorator arrays: `tools`, `resources`, `prompts`, `skills`.

## Step 5 -- Environment Variables

Create a `.env` file (never commit this file):

```env
# Server
PORT=3000
LOG_LEVEL=verbose

# Redis (if using Redis storage)
REDIS_HOST=localhost
REDIS_PORT=6379

# Auth (if using authentication)
# IDP_PROVIDER_URL=https://your-idp.example.com
# IDP_EXPECTED_AUDIENCE=https://your-idp.example.com
```

For Vercel deployments, set these in the Vercel dashboard or `.env.local`.

Confirm `.env` is in `.gitignore`:

```bash
echo ".env" >> .gitignore
```

## Step 6 -- Run in Development Mode

```bash
# Start the dev server with hot reload
frontmcp dev
```

Or if using package.json scripts:

```bash
yarn dev
```

The server starts in stdio mode by default. To test with HTTP transport, set the PORT:

```bash
PORT=3000 frontmcp dev
```

Test with curl:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'
```

Build for production:

```bash
frontmcp build --target node          # Node.js server bundle
frontmcp build --target vercel        # Vercel serverless
frontmcp build --target lambda        # AWS Lambda
frontmcp build --target cloudflare    # Cloudflare Workers
frontmcp build --target cli           # CLI with SEA binary
frontmcp build --target cli --js      # CLI without SEA
frontmcp build --target sdk           # Library (CJS+ESM+types)
```

## Step 7 -- Nx Workspace Setup (optional)

FrontMCP supports Nx monorepos for larger projects with multiple apps and shared libraries.

### 7a. Scaffold a new Nx workspace

```bash
npx frontmcp create <projectName> --nx
```

This creates a full Nx workspace with the `@frontmcp/nx` plugin pre-installed. After scaffolding:

```bash
cd <projectName>
nx g @frontmcp/nx:app my-app        # Add an app
nx g @frontmcp/nx:lib my-lib         # Add a library
nx g @frontmcp/nx:tool my-tool       # Add a tool to an app
nx g @frontmcp/nx:resource my-res    # Add a resource
nx g @frontmcp/nx:prompt my-prompt   # Add a prompt
nx g @frontmcp/nx:skill my-skill     # Add a skill
nx g @frontmcp/nx:agent my-agent     # Add an agent
nx g @frontmcp/nx:provider my-prov   # Add a provider
nx g @frontmcp/nx:server my-server   # Add a deployment shell
nx dev <serverName>                  # Start dev server
```

### 7b. Adding FrontMCP to an existing Nx workspace

Install the Nx plugin:

```bash
yarn add -D @frontmcp/nx
```

Then generate components:

```bash
nx g @frontmcp/nx:app my-app --directory apps/my-app
nx g @frontmcp/nx:server my-server --directory servers/my-server
```

### 7c. Nx project.json example

If manually configuring, add a `project.json`:

```json
{
  "name": "<projectName>",
  "root": "apps/<projectName>",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "options": {
        "outputPath": "dist/apps/<projectName>",
        "main": "apps/<projectName>/src/main.ts",
        "tsConfig": "apps/<projectName>/tsconfig.json"
      }
    },
    "serve": {
      "executor": "@nx/js:node",
      "options": { "buildTarget": "<projectName>:build" }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "apps/<projectName>/jest.config.ts" }
    }
  }
}
```

Run with: `nx serve <projectName>`.

## Common Patterns

| Pattern                   | Correct                                                                      | Incorrect                                       | Why                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Server class export       | `export default class Server {}` with `@FrontMcp` decorator                  | Named export or no decorator                    | The SDK bootstrap expects a default-exported class decorated with `@FrontMcp`               |
| Decorator prerequisites   | `experimentalDecorators: true` and `emitDecoratorMetadata: true` in tsconfig | Omitting either flag                            | FrontMCP decorators (`@FrontMcp`, `@App`, `@Tool`) rely on both TypeScript compiler options |
| Reflect metadata import   | `import 'reflect-metadata'` at the top of `src/main.ts`                      | Importing it in individual tool/resource files  | The polyfill must load once before any decorator runs; the entry point is the correct place |
| Deployment target storage | External Redis/Vercel KV for serverless targets (Vercel, Lambda, Cloudflare) | In-memory or SQLite storage on serverless       | Serverless functions are stateless; persistent storage requires an external provider        |
| Environment secrets       | `.env` file excluded via `.gitignore`, values read with `process.env`        | Hardcoded secrets in source or committed `.env` | Secrets must never be committed to version control                                          |

## Verification Checklist

### Configuration

- [ ] `tsconfig.json` has `experimentalDecorators: true` and `emitDecoratorMetadata: true`
- [ ] `@frontmcp/sdk`, `zod`, and `reflect-metadata` are listed in `package.json` dependencies
- [ ] `package.json` scripts include `dev`, `build`, and `start` commands
- [ ] Deployment target in `@FrontMcp` metadata matches the intended runtime

### Runtime

- [ ] `src/main.ts` exists with a `@FrontMcp`-decorated default export
- [ ] `import 'reflect-metadata'` is the first import in `src/main.ts`
- [ ] At least one `@App` class is registered in the `apps` array
- [ ] `frontmcp dev` starts without errors and responds to MCP `initialize` requests
- [ ] `.env` file exists locally and is listed in `.gitignore`

## Troubleshooting

| Problem                                               | Cause                                                                                  | Solution                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `TypeError: Reflect.getMetadata is not a function`    | `reflect-metadata` is not imported before decorators execute                           | Add `import 'reflect-metadata'` as the first line in `src/main.ts`                                     |
| Decorators are silently ignored (no tools registered) | `experimentalDecorators` or `emitDecoratorMetadata` is `false` or missing in tsconfig  | Set both to `true` in `compilerOptions` and restart the TypeScript compiler                            |
| `frontmcp dev` exits with "No apps registered"        | The `apps` array in `@FrontMcp` metadata is empty or the `@App` class was not imported | Import your `@App` class and add it to the `apps` array                                                |
| Build fails with "Cannot find module '@frontmcp/sdk'" | Dependencies were not installed after scaffolding                                      | Run `yarn install` (or `npm install` / `pnpm install`) in the project root                             |
| Vercel deploy returns 500 on `/mcp` endpoint          | Transport not set to `modern` or storage not configured for Vercel KV                  | Set `transport: { protocol: 'modern' }` and `redis: { provider: 'vercel-kv' }` in `@FrontMcp` metadata |

## Examples

| Example                                                                             | Level        | Description                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-node-server`](../examples/setup-project/basic-node-server.md)               | Basic        | Scaffold a minimal FrontMCP server with one app and one tool, running on Node.js with HTTP transport.                                                 |
| [`cli-scaffold-with-flags`](../examples/setup-project/cli-scaffold-with-flags.md)   | Basic        | Use the `frontmcp create` CLI to scaffold a complete project non-interactively with explicit flags for deployment target, Redis, and package manager. |
| [`vercel-serverless-server`](../examples/setup-project/vercel-serverless-server.md) | Intermediate | Configure a FrontMCP server for Vercel deployment with Vercel KV storage and modern transport protocol.                                               |

> See all examples in [`examples/setup-project/`](../examples/setup-project/)

## Reference

- [Getting Started Quickstart](https://docs.agentfront.dev/frontmcp/getting-started/quickstart)
- Related skills: `setup-redis`, `setup-sqlite`, `nx-workflow`, `deploy-to-vercel`, `deploy-to-node`, `create-tool`
