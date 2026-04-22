---
name: packaging
description: npm packaging rules for a CloudProvider — peer dependencies, lazy-load safety, module format, SDK version compatibility.
tags: [cloud, npm, packaging, peerDependencies, esm, cjs]
---

# Packaging a Cloud Provider

The SDK discovers your package by **hard-coded name** and lazy-loads it with `require()` wrapped in `try/catch`. Get the package shape right or users will see `cloud config is set but the cloud provider package is not installed` even after `npm install`.

## `package.json` — minimum viable

```json
{
  "name": "@your-org/plugin-yourcloud",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "publishConfig": { "access": "public" },
  "peerDependencies": {
    "@frontmcp/sdk": ">=1.2.0"
  },
  "dependencies": {
    "jose": "^6.0.0"
  }
}
```

## Peer vs regular dependencies

| Package                                         | Where it goes      | Why                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@frontmcp/sdk`                                 | `peerDependencies` | Your code depends on SDK types and DI tokens. If you declared it as a regular dep, npm could install a different SDK version than the host's — symbols wouldn't collide, DI tokens wouldn't match, runtime silently breaks |
| `jose`, `ioredis`, HTTP libs                    | `dependencies`     | These are your implementation detail. Version ownership is yours                                                                                                                                                           |
| `@frontmcp/plugin-approval` (if you compose it) | `dependencies`     | You're embedding its behavior — you own the version                                                                                                                                                                        |

**Never** declare `@frontmcp/sdk` in `dependencies`. npm will happily install both your version and the host's version; at runtime there are two copies of `CloudRuntimeContextToken` (each a different `Symbol.for(...)` instance from a different module graph), and the DI provider can't be resolved.

## Naming

The SDK resolves the provider package by name. Today that name is configured inside `libs/sdk/src/scope/cloud-autoload.ts`. You have three options:

1. **Use the known name** (`@frontmcp/plugin-frontegg`) — only works for the Frontegg integration.
2. **Contribute a resolver registration** upstream — submit a PR to add your name to `KNOWN_PROVIDERS`.
3. **Ship with a custom SDK build** — works for internal enterprise deployments where you control both sides.

A future SDK release is expected to expose a user-registerable resolver (`cloud.resolver?: () => CloudProvider`). Until then, option 2 is the supported path for third-party clouds.

## Module format: ESM or dual-publish

The SDK lazy-requires your package via CJS `require(...)`. Your `main` entry must be resolvable from a CJS caller. Two common setups:

### Dual-publish (recommended)

```json
{
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "default": "./dist/index.js"
    }
  }
}
```

Bundler: `tsup` or `rollup` with a dual `cjs` + `esm` config.

### ESM-only (simpler if your SDK version supports ESM require)

Node 22+ supports `require(ESM)`. If your customers are exclusively on Node 22+ you can ship ESM-only. For broader compatibility, dual-publish.

## `src/index.ts` — the single source of truth

```typescript
// The SDK looks for EXACTLY this exported name.
export { cloudProvider } from './your-cloud.provider.js';

// Optional public exports for customers who want to reach into your types
export type { YourCloudConfig } from './config.js';
export { YourCloudConfigToken } from './tokens.js';
```

> **Critical:** `cloudProvider` MUST be a **named export**. `export default` won't work with the SDK's `mod.cloudProvider` lookup.

## SDK compatibility strategy

Declare a minimum SDK version in `peerDependencies` that matches the version where your required types landed. Track changes:

```json
"peerDependencies": {
  "@frontmcp/sdk": ">=1.2.0 <3.0.0"
}
```

When the SDK hits `2.0.0`, review breaking changes to:

- `CloudProvider` interface shape
- `CloudContributions` fields
- `CloudRuntimeContext` methods
- The package name the resolver expects

Bump your own major if your cloud's behavior changes incompatibly — customers pin via `^0.x.0` or `^1.x.0`.

## Testing your package in a host

Local development without publishing:

```bash
# In your cloud-provider repo
yarn build
yarn pack        # produces a .tgz

# In the consumer repo
yarn add file:../path/to/your-org-plugin-yourcloud-0.1.0.tgz
```

Or with a local registry (verdaccio):

```bash
# In cloud-provider repo
yarn nx run local-registry
yarn npm publish --registry http://localhost:4873

# In consumer
yarn add @your-org/plugin-yourcloud --registry http://localhost:4873
```

Symlinks with `yarn link` also work but risk the "two SDK copies" problem if not careful — prefer tarball-based installs.

## Absent-safe verification

After packaging, verify the SDK handles a missing install:

1. Build a consumer app with `cloud: { ... }` in `@FrontMcp()`.
2. Do NOT install your package.
3. Start the server. Expect: a `warn` log saying the package isn't installed, and the server starts normally.

If the server crashes, your package is exporting something that fails import (e.g. top-level `fetch(...)` side effect). Fix: keep module-top-level free of I/O and side effects.

## Bundle size hygiene

- Tree-shake heavy deps (`jose` has many exports — cherry-pick).
- Don't bundle `@frontmcp/sdk` (it's a peer dep).
- Mark `ioredis`, `kafka-node`, etc., as external in your bundler config — users who don't use those paths shouldn't pay the bytes.

Run `npm pack --dry-run` and inspect the tarball size. A cloud provider plugin with auth + HTTP + one integration should be ~50-80 KB gzipped.

## Version compatibility signal

Expose your compatibility range as a runtime check for extra safety:

```typescript
// src/compat.ts
export const MINIMUM_SDK_VERSION = '1.2.0';

// In your bootstrap:
const sdkVersion = require('@frontmcp/sdk/package.json').version;
if (compareVersions(sdkVersion, MINIMUM_SDK_VERSION) < 0) {
  ctx.logger.error(`yourcloud requires @frontmcp/sdk>=${MINIMUM_SDK_VERSION}, found ${sdkVersion}`);
}
```

Don't throw — the SDK swallows bootstrap errors anyway, so this is advisory. A loud log is enough.

## Reference

- SDK resolver: `libs/sdk/src/scope/cloud-autoload.ts`
- SDK auto-load flow: `libs/sdk/src/front-mcp/front-mcp.ts` (`applyCloudContributions`)
