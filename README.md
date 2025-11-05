[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/agentfront-frontmcp-badge.png)](https://mseep.ai/app/agentfront-frontmcp)

<div align="center">

# FrontMCP 🚀

<strong>The TypeScript-first way to build production-grade MCP servers.</strong>

*Made with ❤️ for TypeScript developers*

[![NPM - @frontmcp/sdk](https://img.shields.io/npm/v/@frontmcp/sdk.svg?v=2)](https://www.npmjs.com/package/@frontmcp/sdk)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/github/license/agentfront/frontmcp.svg?v=1)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

</div>

---

FrontMCP is a **TypeScript-first framework** for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).
You describe servers, apps, tools, resources, and prompts with decorators; FrontMCP handles protocol, transport, DI,
session/auth, and execution flow.

```ts
// src/main.ts
import {FrontMcp, LogLevel} from '@frontmcp/sdk';
import HelloApp from './hello.app';

@FrontMcp({
  info: {name: 'Demo 🚀', version: '0.1.0'},
  apps: [HelloApp],
  http: {port: 3001},
  logging: {level: LogLevel.Info},
})
export default class Server {
}
````

---

<!-- omit in toc -->

## Table of Contents

- [Why FrontMCP?](#why-frontmcp)
- [Installation](#installation)
- [Quickstart](#quickstart)
  - [Minimal Server & App](#minimal-server--app)
  - [Function and Class Tools](#function-and-class-tools)
  - [Scripts & tsconfig](#scripts--tsconfig)
  - [MCP Inspector](#mcp-inspector)
- [Core Concepts](#core-concepts)
  - [Servers](#servers)
  - [Apps](#apps)
  - [Tools](#tools)
  - [Resources](#resources)
  - [Prompts](#prompts)
  - [Providers](#providers)
  - [Adapters](#adapters)
  - [Plugins](#plugins)
- [Authentication](#authentication)
  - [Remote OAuth](#remote-oauth)
  - [Local OAuth](#local-oauth)
- [Sessions & Transport](#sessions--transport)
- [Logging Transports](#logging-transports)
- [Deployment](#deployment)
  - [Local Dev](#local-dev)
  - [Production](#production)
- [Version Alignment](#version-alignment)
- [Contributing](#contributing)
- [License](#license)

---

## Why FrontMCP?

* **TypeScript-native DX** — decorators, Zod validation, strong typing end-to-end
* **Spec-aligned transports** — Streamable HTTP (GET/POST), streaming, sessions
* **Scoped invoker + DI** — secure, composable execution with hooks
* **Adapters & Plugins** — generate tools from OpenAPI; add cross-cutting behavior
* **Auth** — remote OAuth (external IdP) or built-in local OAuth
* **Logging** — pluggable log transports (console, JSONL, HTTP batch, …)

---

## Installation

Choose your package manager:

```bash
# npm
npm i -E @frontmcp/sdk @frontmcp/core zod reflect-metadata
npm i -D typescript tsx @types/node rimraf @modelcontextprotocol/inspector

# yarn
yarn add -E @frontmcp/sdk @frontmcp/core zod reflect-metadata
yarn add -D typescript tsx @types/node rimraf @modelcontextprotocol/inspector

# pnpm
pnpm add -E @frontmcp/sdk @frontmcp/core zod reflect-metadata
pnpm add -D typescript tsx @types/node rimraf @modelcontextprotocol/inspector
```

> Requires **Node 20+**.

---

## Quickstart

### Minimal Server & App

```
src/
  main.ts
  hello.app.ts
  tools/
    greet.tool.ts
```

**`src/main.ts`**

```ts
import 'reflect-metadata';
import {FrontMcp, LogLevel} from '@frontmcp/sdk';
import HelloApp from './hello.app';

@FrontMcp({
  info: {name: 'Hello MCP', version: '0.1.0'},
  apps: [HelloApp],
  http: {port: Number(process.env.PORT) || 3001},
  logging: {level: LogLevel.Info},
})
export default class Server {
}
```

**`src/hello.app.ts`**

```ts
import {App} from '@frontmcp/sdk';
import GreetTool from './tools/greet.tool';

@App({id: 'hello', name: 'Hello', tools: [GreetTool]})
export default class HelloApp {
}
```

### Function and Class Tools

**Function tool**

```ts
import {tool} from '@frontmcp/sdk';
import {z} from 'zod';

export default tool({
  name: 'greet',
  description: 'Greets a user by name',
  inputSchema: z.object({name: z.string()}),
})(({name}) => `Hello, ${name}!`);
```

**Class tool**

```ts
import {Tool} from '@frontmcp/sdk';
import {z} from 'zod';

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: z.object({a: z.number(), b: z.number()}),
})
export default class AddTool {
  execute({a, b}: { a: number; b: number }) {
    return a + b;
  }
}
```

### Scripts & tsconfig

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "lib": [
      "ES2020"
    ],
    "rootDir": "src",
    "outDir": "dist",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true
  },
  "include": [
    "src/**/*.ts"
  ],
  "exclude": [
    "**/*.test.ts",
    "**/__tests__/**"
  ]
}
```

**`tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "sourceMap": false
  },
  "exclude": [
    "**/*.test.ts",
    "**/__tests__/**",
    "src/**/*.dev.ts"
  ]
}
```

**`package.json` (scripts)**

```json
{
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start:dev": "tsx src/main.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "clean": "rimraf dist",
    "inspect:dev": "npx @modelcontextprotocol/inspector tsx src/main.ts",
    "inspect:dist": "npx @modelcontextprotocol/inspector node dist/main.js"
  }
}
```

> Always import **`reflect-metadata` first** in your entry to enable decorator metadata.

### MCP Inspector

Debug your server with a browser UI:

```bash
# Dev (runs TS)
npm run inspect:dev
# Dist (runs built JS)
npm run inspect:dist
```

---

## Core Concepts

### Servers

The decorated entry (`@FrontMcp`) defines server **info**, **apps**, **http**, **logging**, **session**, optional **auth
**, and shared **providers**.

### Apps

Use `@App` to group **tools**, **resources**, **prompts**, **providers**, **adapters**, and **plugins**. With
`splitByApp: true`, each app has its own scope/base path and (optionally) its own auth.

### Tools

Active actions with input/output schemas. Use class tools (`@Tool`) or function tools (`tool({...})(handler)`).

### Resources

Expose read-only data by URI. Define with `@Resource` or `resource(...)` (see docs).

### Prompts

Reusable prompt templates (`@Prompt` / `prompt(...)`) supplying arguments for LLM interactions.

### Providers

Dependency-injected singletons for config/DB/Redis/KMS/etc., with scopes: **GLOBAL**, **SESSION**, **REQUEST**.

### Adapters

Generate tools/resources/prompts from external definitions (e.g., **OpenAPI**).

### Plugins

Cross-cutting behavior (caching, tracing, policy). Plugins can contribute providers/adapters/tools/resources/prompts.

---

## Authentication

You can configure auth on the server (multi-app shared) or per app (isolated scopes).

### Remote OAuth

```ts
auth: {
  type: 'remote',
          name: 'frontegg',
          baseUrl: 'https://idp.example.com',
          dcrEnabled ? : boolean,
          clientId ? : string | ((info: { clientId: string }) => string),
          mode ? : 'orchestrated' | 'transparent',
          allowAnonymous ? : boolean,
          consent ? : boolean,
          scopes ? : string[],
          grantTypes ? : ('authorization_code' | 'refresh_token')[],
          authEndpoint ? : string,
          tokenEndpoint ? : string,
          registrationEndpoint ? : string,
          userInfoEndpoint ? : string,
          jwks ? : JSONWebKeySet,
          jwksUri ? : string
}
```

### Local OAuth

```ts
{
  auth: {
    type: 'local',
            id: 'local',
            name: 'Local Auth',
            scopes?: string[],
            grantTypes?: ('authorization_code' | 'refresh_token')[],
            allowAnonymous?: boolean, // default true
            consent?: boolean,
            jwks?: JSONWebKeySet,
            signKey?: JWK | Uint8Array
  }
```

> With `splitByApp: true`, define auth **per `@App`** (server-level `auth` is disallowed).

---

## Sessions & Transport

```ts
session: {
  sessionMode ? : 'stateful' | 'stateless' | ((issuer) =>
...), // default 'stateless'
  transportIdMode ? : 'uuid' | 'jwt' | ((issuer) =>
...),       // default 'uuid'
}
```

* **Stateful**: server-side store for tokens; enables refresh; recommended for short-lived upstream tokens.
* **Stateless**: tokens embedded in JWT; simpler but no silent refresh.
* **Transport IDs**: `uuid` (per node) or `jwt` (signed; distributed setups).

---

## Logging Transports

Add custom log sinks via `@LogTransport`:

```ts
import {LogTransport, LogTransportInterface, LogRecord} from '@frontmcp/sdk';

@LogTransport({name: 'StructuredJson', description: 'JSONL to stdout'})
export class StructuredJsonTransport extends LogTransportInterface {
  log(rec: LogRecord): void {
    try {
      process.stdout.write(JSON.stringify({
        ts: rec.timestamp.toISOString(),
        level: rec.levelName,
        msg: String(rec.message),
        prefix: rec.prefix || undefined,
        args: (rec.args || []).map(String),
      }) + '\n');
    } catch {
    }
  }
}
```

Register:

```ts
logging: {
  level: LogLevel.Info,
          enableConsole: false,
          transports : [StructuredJsonTransport],
}
```

---

## Deployment

### Local Dev

```bash
# npm
npm run dev
# yarn
yarn dev
# pnpm
pnpm dev
```

* HTTP default: `http.port` (e.g., 3001)
* `http.entryPath` defaults to `''` (set to `/mcp` if you prefer)

---

## Version Alignment

If versions drift, the runtime may throw a "version mismatch" error at boot. Keep `@frontmcp/sdk` and `@frontmcp/core`
on the **same version** across your workspace.

---

## Contributing

PRs welcome! Please:

* Keep changes focused and tested
* Run `typecheck`, `build`, and try **MCP Inspector** locally
* Align `@frontmcp/*` versions in examples

---

## License

See [LICENSE](./LICENSE).

