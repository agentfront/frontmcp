<div align="center">

<picture>
  <source width="400" media="(prefers-color-scheme: dark)" srcset="docs/images/frontmcp.dark.svg">
  <source width="400" media="(prefers-color-scheme: light)" srcset="docs/images/frontmcp.light.svg">
  <img width="400" alt="FrontMCP Logo" src="docs/images/frontmcp.light.svg">
</picture>
<hr>

<strong>The TypeScript way to build MCP servers with decorators, DI, and Streamable HTTP.</strong>

_Made with ❤️ for TypeScript developers_

[![NPM - @frontmcp/sdk](https://img.shields.io/npm/v/@frontmcp/sdk.svg?v=2)](https://www.npmjs.com/package/@frontmcp/sdk)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/github/license/agentfront/frontmcp.svg?v=1)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

</div>

---

FrontMCP is a **TypeScript-first framework** for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).
You write clean, typed code; FrontMCP handles the protocol, transport, DI, session/auth, and execution flow.

```ts
// src/main.ts
import 'reflect-metadata';
import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import HelloApp from './hello.app';

@FrontMcp({
  info: { name: 'Demo 🚀', version: '0.1.0' },
  apps: [HelloApp],
  http: { port: 3000 },
  logging: { level: LogLevel.Info },
})
export default class Server {}
````

---

<!-- omit in toc -->

## Table of Contents

* [Why FrontMCP?](#why-frontmcp)
* [Installation](#installation)
* [Quickstart](#quickstart)

  * [Minimal Server & App](#minimal-server--app)
  * [Function and Class Tools](#function-and-class-tools)
  * [Scripts & tsconfig](#scripts--tsconfig)
  * [Inspector](#inspector)
* [Core Concepts](#core-concepts)

  * [Servers](#servers)
  * [Apps](#apps)
  * [Tools](#tools)
  * [Resources](#resources)
  * [Prompts](#prompts)
  * [Providers / Adapters / Plugins](#providers--adapters--plugins)
* [Authentication](#authentication)

  * [Remote OAuth](#remote-oauth)
  * [Local OAuth](#local-oauth)
* [Sessions & Transport](#sessions--transport)
* [Deployment](#deployment)

  * [Local Dev](#local-dev)
  * [Production](#production)
* [Version Alignment](#version-alignment)
* [Contributing](#contributing)
* [License](#license)

---

## Why FrontMCP?

* **TypeScript-native DX** — decorators, Zod, strong typing end-to-end
* **Spec-aligned transport** — Streamable HTTP, sessions, server‑pushed events
* **Scoped invoker + DI** — secure, composable execution with hooks
* **Adapters & Plugins** — generate tools from OpenAPI; add cross-cutting behavior
* **Auth** — remote OAuth (external IdP) or built-in local OAuth
* **Logging** — pluggable log transports

---

## Installation

**Prereqs:** Node.js ≥ 22, npm ≥ 10. ([Installation - FrontMCP][1])

### Option A — New project (recommended)

```bash
npx frontmcp create my-app
```

This scaffolds a FrontMCP project, writes a modern ESM `tsconfig.json` for decorators, adds helpful package scripts, and installs required dev deps. ([Installation - FrontMCP][1])

### Option B — Add to an existing project

```bash
npm i -D frontmcp @types/node@^20
npx frontmcp init
```

`init` adds scripts, verifies your `tsconfig.json`, and checks layout. No need to install `@frontmcp/sdk` directly—the CLI bundles a compatible SDK for you. ([Installation - FrontMCP][1])

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
import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import HelloApp from './hello.app';

@FrontMcp({
  info: { name: 'Hello MCP', version: '0.1.0' },
  apps: [HelloApp],
  http: { port: 3000 },
  logging: { level: LogLevel.Info },
})
export default class Server {}
```

**`src/hello.app.ts`**

```ts
import { App } from '@frontmcp/sdk';
import GreetTool from './tools/greet.tool';

@App({ id: 'hello', name: 'Hello', tools: [GreetTool] })
export default class HelloApp {}
```

### Function and Class Tools

> New ergonomic schemas: pass **Zod fields directly** (no `z.object({...})`). ([Tools - FrontMCP][4])

**Function tool**

```ts
import { tool } from '@frontmcp/sdk';
import { z } from 'zod';

export default tool({
  name: 'greet',
  description: 'Greets a user by name',
  inputSchema: { name: z.string() }, // shape, not z.object
})(({ name }) => `Hello, ${name}!`);
```

**Class tool**

```ts
import { Tool } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: { a: z.number(), b: z.number() },
})
export default class AddTool {
  async execute({ a, b }: { a: number; b: number }) {
    return a + b;
  }
}
```

### Scripts & tsconfig

After `create` or `init`, you’ll have:

```json
{
  "scripts": {
    "dev": "frontmcp dev",
    "build": "frontmcp build",
    "inspect": "frontmcp inspector",
    "doctor": "frontmcp doctor"
  }
}
```

These map to dev watch, production build, zero‑setup Inspector launch, and environment checks. ([Installation - FrontMCP][1])

**Recommended `tsconfig.json` (ESM + decorators)**

```json
{
  "compilerOptions": {
    "target": "es2021",
    "module": "esnext",
    "lib": ["es2021"],
    "moduleResolution": "bundler",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts", "**/__tests__/**"]
}
```

This mirrors what `init` writes for you. ([Local Dev Server - FrontMCP][3])

**Optional `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "sourceMap": false
  },
  "exclude": ["**/*.test.ts", "**/__tests__/**", "src/**/*.dev.ts"]
}
```

### Inspector

Run a browser UI to exercise tools and messages:

```bash
npm run inspect
```

This launches the MCP Inspector; point it at your local server (e.g., `http://localhost:3000`). ([Local Dev Server - FrontMCP][3])

---

## Core Concepts

### Servers

`@FrontMcp({...})` defines **info**, **apps**, **http**, **logging**, **session**, and optional **auth**. Keep it minimal or scale up with providers and plugins. ([The FrontMCP Server - FrontMCP][5])

### Apps

Use `@App` to group **tools**, **resources**, **prompts**, plus **providers**, **adapters**, and **plugins**. With `splitByApp: true`, each app gets its own scope/base path and, if needed, its own auth surface. ([Apps - FrontMCP][6])

### Tools

Typed actions with schemas (class `@Tool` or inline `tool({...})(handler)`). Use the Zod‑field **shape** style for `inputSchema`. ([Tools - FrontMCP][4])

### Resources

Readable data by URI or RFC6570 template (see `@Resource` / `@ResourceTemplate`). ([Resources - FrontMCP][7])

### Prompts

Reusable templates returning MCP `GetPromptResult`, with typed arguments. ([Prompts - FrontMCP][8])

### Providers / Adapters / Plugins

Inject shared services, generate tools from OpenAPI, and add cross‑cutting behavior like caching and hooks. ([Add OpenAPI Adapter - FrontMCP][9])

---

## Authentication

Configure auth at the **server** (shared) or **per app** (isolated). With `splitByApp: true`, define auth **per app** (server‑level `auth` is disallowed). ([Authentication - FrontMCP][10])

### Remote OAuth

```ts
auth: {
  type: 'remote',
  name: 'frontegg',
  baseUrl: 'https://idp.example.com',
  dcrEnabled?: boolean,
  clientId?: string | ((info: { clientId: string }) => string),
  mode?: 'orchestrated' | 'transparent',
  allowAnonymous?: boolean,
  consent?: boolean,
  scopes?: string[],
  grantTypes?: ('authorization_code' | 'refresh_token')[],
  authEndpoint?: string,
  tokenEndpoint?: string,
  registrationEndpoint?: string,
  userInfoEndpoint?: string,
  jwks?: JSONWebKeySet,
  jwksUri?: string
}
```

See **Authentication → Remote OAuth** for full details and DCR vs non‑DCR. ([Remote OAuth - FrontMCP][11])

### Local OAuth

```ts
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

Use per‑app when isolating scopes. ([Local OAuth - FrontMCP][12])

---

## Sessions & Transport

```ts
session: {
  sessionMode?: 'stateful' | 'stateless' | ((issuer) => ...), // default 'stateless'
  transportIdMode?: 'uuid' | 'jwt' | ((issuer) => ...),       // default 'uuid'
}
```

* **Stateful**: server‑side store (e.g., Redis); supports refresh; best for short‑lived upstream tokens.
* **Stateless**: embeds session in JWT; simpler but no silent refresh.
* **Transport IDs**: `uuid` (per node) or `jwt` (signed; distributed setups). ([The FrontMCP Server - FrontMCP][5])

---

## Deployment

### Local Dev

```bash
npm run dev
```

* Default HTTP port: `3000` unless configured
* `npm run doctor` checks Node/npm versions, `tsconfig`, and scripts. ([Local Dev Server - FrontMCP][3])

### Production

```bash
npm run build
NODE_ENV=production PORT=8080 npm start
```

Builds to `dist/` (uses `tsconfig.build.json`). Consider a process manager and reverse proxy; align all `@frontmcp/*` versions. ([Production Build - FrontMCP][13])

---

## Version Alignment

If versions drift, the runtime will throw a clear **“version mismatch”** at boot. Keep `@frontmcp/*` versions aligned. ([Production Build - FrontMCP][13])

---

## Contributing

PRs welcome! Please:

* Keep changes focused and tested
* Run `doctor`, `dev`, and `build`; try **Inspector** locally
* Align `@frontmcp/*` versions in examples

---

## License

See [LICENSE](./LICENSE).




[1]: https://docs.agentfront.dev/0.3/getting-started/installation "Installation - FrontMCP"
[2]: https://docs.agentfront.dev/0.3/getting-started/quickstart "Quickstart - FrontMCP"
[3]: https://docs.agentfront.dev/0.3/deployment/local-dev-server "Local Dev Server - FrontMCP"
[4]: https://docs.agentfront.dev/0.3/servers/tools "Tools - FrontMCP"
[5]: https://docs.agentfront.dev/0.3/servers/server "The FrontMCP Server - FrontMCP"
[6]: https://docs.agentfront.dev/0.3/servers/apps "Apps - FrontMCP"
[7]: https://docs.agentfront.dev/0.3/servers/resources "Resources - FrontMCP"
[8]: https://docs.agentfront.dev/0.3/servers/prompts "Prompts - FrontMCP"
[9]: https://docs.agentfront.dev/0.3/guides/add-openapi-adapter "Add OpenAPI Adapter - FrontMCP"
[10]: https://docs.agentfront.dev/0.3/servers/authentication/overview "Authentication - FrontMCP"
[11]: https://docs.agentfront.dev/0.3/servers/authentication/remote "Remote OAuth - FrontMCP"
[12]: https://docs.agentfront.dev/0.3/servers/authentication/local "Local OAuth - FrontMCP"
[13]: https://docs.agentfront.dev/0.3/deployment/production-build "Production Build - FrontMCP"
