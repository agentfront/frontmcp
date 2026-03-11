# Browser Compatibility Audit & Migration Plan

## Context

FrontMCP libraries currently target Node.js only. Many packages (`utils`, `auth`, `sdk`, `di`, `uipack`, `ui`) have APIs that are useful in browser contexts (crypto, DI, context propagation, etc.), but they statically import Node-only modules (`node:async_hooks`, `node:crypto`, `node:buffer`, `fs`, `child_process`, `ioredis`). Rather than publishing separate `-browser` packages, we'll use Node.js **conditional `#imports`** (package.json `"imports"` field) so a single package resolves the correct implementation at build/runtime based on platform.

## Package Classification

### Node-only (no changes)

| Package                    | Reason                             |
| -------------------------- | ---------------------------------- |
| `@frontmcp/cli`            | CLI tool                           |
| `@frontmcp/nx`             | Nx build plugin                    |
| `@frontmcp/storage-sqlite` | `better-sqlite3` native bindings   |
| `@frontmcp/testing`        | Mock HTTP servers, Jest/Playwright |

### Already browser-compatible (no changes)

| Package              | Reason                          |
| -------------------- | ------------------------------- |
| `@frontmcp/di`       | Pure TS, no Node APIs           |
| `@frontmcp/uipack`   | Built with `platform: neutral`  |
| `@frontmcp/ui`       | Built with `platform: neutral`  |
| `@frontmcp/plugins`  | Meta-package, no Node imports   |
| `@frontmcp/adapters` | Only test files use `node:http` |

### Needs browser alternatives (this plan)

| Package           | Phase |
| ----------------- | ----- |
| `@frontmcp/utils` | 1     |
| `@frontmcp/auth`  | 2     |
| `@frontmcp/sdk`   | 2-3   |

---

## Phase 1: @frontmcp/utils (foundation)

All other packages depend on utils. It must be browser-safe first.

### 1.1 `#crypto-provider` — Replace runtime `require()` dispatch with compile-time conditional

**Problem:** `libs/utils/src/crypto/index.ts:27-31` uses `require('./node')` and `require('./browser')` with `isNode()` checks. Bundlers can't statically analyze this and may pull `node:crypto` into browser bundles.

**Files to create:**
| File | Content |
|---|---|
| `libs/utils/src/crypto/provider.node.ts` | Re-exports `nodeCrypto` from `./node` as `platformCrypto` |
| `libs/utils/src/crypto/provider.browser.ts` | Re-exports `browserCrypto` from `./browser` as `platformCrypto` |

**File to modify:**

- `libs/utils/src/crypto/index.ts` — Replace lazy `getCrypto()` require-based dispatch with `import { platformCrypto } from '#crypto-provider'`. Remove `isNode()` check for provider selection. Keep `rsaVerify()` as Node-only with `assertNode()`.

### 1.2 `#async-local-storage` — Shared polyfill for browser

**Problem:** `AsyncLocalStorage` from `node:async_hooks` is used in 3 files across auth and sdk. Browsers have no equivalent.

**Files to create in utils:**
| File | Content |
|---|---|
| `libs/utils/src/async-context/async-local-storage.node.ts` | Re-exports `AsyncLocalStorage` from `node:async_hooks` |
| `libs/utils/src/async-context/async-local-storage.browser.ts` | Stack-based polyfill (safe: browsers are single-threaded) |
| `libs/utils/src/async-context/index.ts` | Barrel: `export { AsyncLocalStorage } from '#async-local-storage'` |

**Browser polyfill implementation:**

```typescript
export class AsyncLocalStorage<T> {
  private stack: T[] = [];
  run<R>(store: T, fn: () => R): R {
    this.stack.push(store);
    try {
      return fn();
    } finally {
      this.stack.pop();
    }
  }
  getStore(): T | undefined {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
  }
}
```

**Add to utils barrel** (`libs/utils/src/index.ts`): `export { AsyncLocalStorage } from './async-context'`

### 1.3 `#env` — Environment variable access

**Problem:** `process.env` / `process.cwd()` are used in SDK core paths (`scope.instance.ts`, `mcp.error.ts`, `instance.logger.ts`, `storage/factory.ts`) that end up in browser bundles. `process` may not exist in browsers.

**Files to create in utils:**
| File | Content |
|---|---|
| `libs/utils/src/env/env.node.ts` | `getEnv(key)` → `process.env[key]`, `getCwd()` → `process.cwd()`, `isProduction()` → `NODE_ENV === 'production'` |
| `libs/utils/src/env/env.browser.ts` | `getEnv()` → `undefined`, `getCwd()` → `'/'`, `isProduction()` → `false` |
| `libs/utils/src/env/index.ts` | Barrel |

**Add to utils barrel**: `export { getEnv, getCwd, isProduction } from './env'`

### 1.4 `#key-persistence-factory` — Remove static FileSystem import from browser

**Problem:** `libs/utils/src/crypto/key-persistence/factory.ts:12` statically imports `FileSystemStorageAdapter`, pulling `fs` into browser bundles even though the runtime `isNode()` check at line 38 would select `MemoryStorageAdapter`.

**Files to create:**
| File | Content |
|---|---|
| `libs/utils/src/crypto/key-persistence/factory.browser.ts` | Same `createKeyPersistence()` API but only provides `MemoryStorageAdapter`, no filesystem import |

**File to rename:**

- `factory.ts` → `factory.node.ts` (or keep as `factory.ts` and use it as the `"default"` target)

### 1.5 `#storage-factory` — Protect `process.env` in storage auto-detection

**Problem:** `libs/utils/src/storage/factory.ts:16-46` uses `process.env` directly for `isProduction()` and `detectStorageType()`.

**Files to create:**
| File | Content |
|---|---|
| `libs/utils/src/storage/factory.browser.ts` | `detectStorageType()` always returns `'memory'`, `createAdapter()` only supports `'memory'`, no `process.env` |

### 1.6 Utils `package.json` additions

```json
{
  "imports": {
    "#crypto-provider": {
      "browser": "./src/crypto/provider.browser.ts",
      "default": "./src/crypto/provider.node.ts"
    },
    "#async-local-storage": {
      "browser": "./src/async-context/async-local-storage.browser.ts",
      "default": "./src/async-context/async-local-storage.node.ts"
    },
    "#env": {
      "browser": "./src/env/env.browser.ts",
      "default": "./src/env/env.node.ts"
    },
    "#key-persistence-factory": {
      "browser": "./src/crypto/key-persistence/factory.browser.ts",
      "default": "./src/crypto/key-persistence/factory.ts"
    },
    "#storage-factory": {
      "browser": "./src/storage/factory.browser.ts",
      "default": "./src/storage/factory.ts"
    }
  }
}
```

**Build note:** Published dist `package.json` must map `./src/*.ts` → `./dist/*.js` / `./dist/esm/*.mjs`. The `strip-dist-from-pkg.js` script or build targets need updating to rewrite these paths.

### Files safe to SKIP in utils

| File                                            | Reason                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `libs/utils/src/fs/fs.ts`                       | Already has `assertNode()` guards, no browser alternative makes sense |
| `libs/utils/src/crypto/secret-persistence/`     | Disk-based persistence, fundamentally Node-only                       |
| `libs/utils/src/storage/adapters/redis.ts`      | Lazy `require('ioredis')`, never reached in browser                   |
| `libs/utils/src/storage/adapters/filesystem.ts` | Uses assertNode-guarded fs functions                                  |

---

## Phase 2: @frontmcp/auth + @frontmcp/sdk (core)

### 2.1 Auth: `encrypted-authorization-vault.ts`

**File:** `libs/auth/src/session/encrypted-authorization-vault.ts:28`
**Change:** Replace `import { AsyncLocalStorage } from 'node:async_hooks'` with `import { AsyncLocalStorage } from '@frontmcp/utils'`
**No new files needed** — conditional import handled at utils layer.

### 2.2 Auth: Other files — SKIP

| File                     | Reason                                                            |
| ------------------------ | ----------------------------------------------------------------- |
| `redis-session.store.ts` | Type-only `ioredis` import, server-only store                     |
| `jwks.service.ts`        | Lazy `require('node:crypto')` for RSA key generation, server-only |

### 2.3 SDK: `frontmcp-context-storage.ts`

**File:** `libs/sdk/src/context/frontmcp-context-storage.ts:21`
**Change:** Replace `import { AsyncLocalStorage } from 'node:async_hooks'` with `import { AsyncLocalStorage } from '@frontmcp/utils'`

### 2.4 SDK: `skill-session.manager.ts`

**File:** `libs/sdk/src/skill/session/skill-session.manager.ts:3-4`
**Changes:**

- Line 3: Replace `import { AsyncLocalStorage } from 'async_hooks'` with `import { AsyncLocalStorage } from '@frontmcp/utils'`
- Line 4: Replace `import { EventEmitter } from 'events'` with `mitt` (already a dep of `@frontmcp/di`). Or add a `#event-emitter` conditional import in utils. Recommend refactoring to `mitt` since the manager only needs `.emit()` and listener methods.

### 2.5 SDK: `process.env` in core paths

These files are re-exported from the main SDK barrel and will end up in browser bundles:

| File                                          | Line(s)      | Change                                                          |
| --------------------------------------------- | ------------ | --------------------------------------------------------------- | --- | ---------- |
| `scope/scope.instance.ts`                     | 137, 729-731 | Use `getEnv()` and `isProduction()` from `@frontmcp/utils`      |
| `errors/mcp.error.ts`                         | 534          | Use `isProduction()` from `@frontmcp/utils`                     |
| `logger/instances/instance.logger.ts`         | 86           | Use `getEnv()` from `@frontmcp/utils`                           |
| `logger/instances/instance.console-logger.ts` | 66           | Use `getEnv()` from `@frontmcp/utils` (already has `process.env |     | {}` guard) |
| `tool/flows/call-tool.flow.ts`                | 796          | Use `getEnv()` from `@frontmcp/utils`                           |

### 2.6 SDK: `index.ts` top-level `process.emitWarning` IIFE

**File:** `libs/sdk/src/index.ts:7-17`
**Problem:** The IIFE immediately calls `process.emitWarning.bind(process)` at import time. This will crash in browsers.
**Change:** Guard with `typeof process !== 'undefined' && process.emitWarning` check.

### 2.7 SDK: `server.validation.ts` (`Buffer` from `node:buffer`)

**Status:** SKIP — This file is in `server/` directory, writes HTTP responses. Server-only path. However, verify it's not pulled into the main barrel via `export * from './common'`. If it is, it needs to be behind a separate `@frontmcp/sdk/server` export path.

### 2.8 SDK: Server adapters and transports — SKIP

| File                                       | Reason                                                       |
| ------------------------------------------ | ------------------------------------------------------------ |
| `server/adapters/express.host.adapter.ts`  | Server-only, behind `./transport` export                     |
| `transport/adapters/base-sse-transport.ts` | Server-only transport                                        |
| `transport/adapters/sse-transport.ts`      | Server-only transport                                        |
| `skill/skill-directory-loader.ts`          | Filesystem-based, `assertNode` guards in utils' fs functions |
| `front-mcp/front-mcp.ts`                   | Server startup with `process.exit()`, server-only            |
| `builtin/config/*`                         | Config loading from .env files, server-only                  |
| All `require('ioredis')` factory files     | Lazy-loaded, never reached in browser                        |

### 2.9 SDK: `common/interfaces/server.interface.ts`

**File:** `libs/sdk/src/common/interfaces/server.interface.ts:1`
**Problem:** `import { IncomingMessage, ServerResponse } from 'http'` — runtime class extension, pulled into barrel via `export * from './common'`.
**Action:** Investigate if this leaks into browser bundles via the main barrel. If yes, either:

- Move to a separate `@frontmcp/sdk/server` export, or
- Add a `#server-types` conditional import with empty browser stubs

---

## Phase 3: Build System

### 3.1 Utils `project.json` — Add browser build target

Add a `build-browser` Nx target using esbuild with `platform: "browser"` or `platform: "neutral"` and `conditions: ["browser"]` to properly resolve `#imports`.

### 3.2 Dist-time path rewriting

The `"imports"` field in the **published** `package.json` must reference compiled `.js`/`.mjs` paths, not `.ts` source files. Update `strip-dist-from-pkg.js` to rewrite paths in the `"imports"` field (same as it does for `"exports"`).

### 3.3 TypeScript `moduleResolution`

Ensure `tsconfig.lib.json` for affected packages uses `"moduleResolution": "NodeNext"` or `"Node16"` which supports `#imports` natively. Verify current settings.

### 3.4 esbuild `conditions` support

esbuild supports `conditions` since v0.17. Verify the Nx esbuild executor version passes `conditions` through `esbuildOptions`. The SDK and auth builds need `conditions: ["node"]` (default), while a new browser target would use `conditions: ["browser"]`.

---

## New Files Summary

| New File                                                      | Purpose                                          |
| ------------------------------------------------------------- | ------------------------------------------------ |
| `libs/utils/src/crypto/provider.node.ts`                      | Re-exports `nodeCrypto` as `platformCrypto`      |
| `libs/utils/src/crypto/provider.browser.ts`                   | Re-exports `browserCrypto` as `platformCrypto`   |
| `libs/utils/src/async-context/async-local-storage.node.ts`    | Re-exports Node's `AsyncLocalStorage`            |
| `libs/utils/src/async-context/async-local-storage.browser.ts` | Stack-based polyfill                             |
| `libs/utils/src/async-context/index.ts`                       | Barrel export                                    |
| `libs/utils/src/env/env.node.ts`                              | `getEnv`, `getCwd`, `isProduction` via `process` |
| `libs/utils/src/env/env.browser.ts`                           | Safe stubs returning `undefined`/`false`         |
| `libs/utils/src/env/index.ts`                                 | Barrel export                                    |
| `libs/utils/src/crypto/key-persistence/factory.browser.ts`    | Memory-only key persistence factory              |
| `libs/utils/src/storage/factory.browser.ts`                   | Memory-only storage factory                      |

## Files to Modify

| File                                                       | Change                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `libs/utils/src/crypto/index.ts`                           | Use `#crypto-provider` instead of `require()` dispatch                    |
| `libs/utils/src/index.ts`                                  | Add `AsyncLocalStorage`, `getEnv`, `getCwd`, `isProduction` exports       |
| `libs/utils/package.json`                                  | Add `"imports"` field                                                     |
| `libs/auth/src/session/encrypted-authorization-vault.ts`   | Import `AsyncLocalStorage` from `@frontmcp/utils`                         |
| `libs/sdk/src/context/frontmcp-context-storage.ts`         | Import `AsyncLocalStorage` from `@frontmcp/utils`                         |
| `libs/sdk/src/skill/session/skill-session.manager.ts`      | Import `AsyncLocalStorage` from `@frontmcp/utils`, replace `EventEmitter` |
| `libs/sdk/src/scope/scope.instance.ts`                     | Use `getEnv()` from `@frontmcp/utils`                                     |
| `libs/sdk/src/errors/mcp.error.ts`                         | Use `isProduction()` from `@frontmcp/utils`                               |
| `libs/sdk/src/logger/instances/instance.logger.ts`         | Use `getEnv()` from `@frontmcp/utils`                                     |
| `libs/sdk/src/logger/instances/instance.console-logger.ts` | Use `getEnv()` from `@frontmcp/utils`                                     |
| `libs/sdk/src/tool/flows/call-tool.flow.ts`                | Use `getEnv()` from `@frontmcp/utils`                                     |
| `libs/sdk/src/index.ts`                                    | Guard `process.emitWarning` IIFE                                          |
| `libs/utils/project.json`                                  | Add `build-browser` target                                                |

---

## Verification

1. **Unit tests pass:** `npx nx test utils && npx nx test auth && npx nx test sdk`
2. **Build succeeds:** `npx nx build utils && npx nx build auth && npx nx build sdk`
3. **Browser bundle test:** Create a test esbuild script with `platform: 'browser'` that imports `@frontmcp/utils` and verify:
   - No `node:*` modules in the bundle
   - `crypto` operations work (use `browserCrypto`)
   - `AsyncLocalStorage` polyfill works
   - `getEnv()` returns `undefined`
4. **Node still works:** Existing tests continue to pass — the `"default"` condition resolves to Node implementations
5. **Run unused imports cleanup:** `node scripts/fix-unused-imports.mjs`
