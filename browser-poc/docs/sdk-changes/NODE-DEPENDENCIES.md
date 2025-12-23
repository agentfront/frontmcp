# Node.js Dependencies Analysis

Complete inventory of Node.js-specific code in `libs/sdk` that must be addressed for browser compatibility.

## Summary

| Category             | Count | Priority |
| -------------------- | ----- | -------- |
| Built-in modules     | 6     | High     |
| Third-party packages | 4     | Medium   |
| Files affected       | 27    | -        |

## Node.js Built-in Modules

### 1. `crypto` Module

**Usage:** UUID generation, hashing, encryption

| Function             | Files     | Browser Alternative            |
| -------------------- | --------- | ------------------------------ |
| `randomUUID()`       | 10+ files | `crypto.randomUUID()` (native) |
| `randomBytes()`      | 4 files   | `crypto.getRandomValues()`     |
| `createHash()`       | 3 files   | `crypto.subtle.digest()`       |
| `createCipheriv()`   | 2 files   | `crypto.subtle.encrypt()`      |
| `createDecipheriv()` | 2 files   | `crypto.subtle.decrypt()`      |
| `createHmac()`       | 1 file    | `crypto.subtle.sign()`         |

**Files using crypto:**

```
libs/sdk/src/flows/flow.instance.ts:8
  └── import { randomUUID } from 'crypto'

libs/sdk/src/flows/flow.registry.ts:4
  └── import { randomUUID } from 'crypto'

libs/sdk/src/errors/mcp.error.ts:3
  └── import { randomBytes } from 'crypto'

libs/sdk/src/common/interfaces/execution-context.interface.ts:3
  └── import { randomUUID } from 'crypto'

libs/sdk/src/transport/transport.registry.ts:4
  └── import { createHash } from 'crypto'

libs/sdk/src/tool/flows/call-tool.flow.ts:5
  └── import { randomUUID } from 'crypto'

libs/sdk/src/common/schemas/http-output.schema.ts
  └── import { randomUUID } from 'crypto'

libs/sdk/src/auth/session/redis-session.store.ts
  └── import { randomUUID } from 'crypto'

libs/sdk/src/auth/session/transport-session.manager.ts
  └── import { randomUUID } from 'crypto'

libs/sdk/src/auth/session/utils/session-id.utils.ts
  └── import { randomUUID, createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto'

libs/sdk/src/auth/session/vault-encryption.ts
  └── import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'crypto'

libs/sdk/src/auth/jwks/dev-key-persistence.ts
  └── import { randomBytes } from 'crypto'

libs/sdk/src/auth/flows/oauth.token.flow.ts
  └── import { randomUUID } from 'crypto'

libs/sdk/src/auth/flows/oauth.callback.flow.ts
  └── import { randomUUID, createHash } from 'crypto'

libs/sdk/src/auth/authorization/transparent.authorization.ts
  └── import { createHash } from 'crypto'

libs/sdk/src/auth/authorization/orchestrated.authorization.ts
  └── import { createHash } from 'crypto'

libs/sdk/src/auth/authorization/public.authorization.ts
  └── import { randomUUID } from 'crypto'

libs/sdk/src/auth/authorization/authorization.class.ts
  └── import { randomUUID } from 'crypto'

libs/sdk/src/auth/instances/instance.local-primary-auth.ts
  └── import { randomBytes, randomUUID } from 'crypto'
```

### 2. `http` Module

**Usage:** Server infrastructure, request/response types

| Import            | Files   | Browser Alternative |
| ----------------- | ------- | ------------------- |
| `IncomingMessage` | 2 files | Custom interface    |
| `ServerResponse`  | 2 files | Custom interface    |
| `createServer()`  | 1 file  | Not needed          |

**Files using http:**

```
libs/sdk/src/common/interfaces/server.interface.ts
  └── import { IncomingMessage, ServerResponse } from 'http'

libs/sdk/src/transport/legacy/legacy.sse.tranporter.ts
  └── import { IncomingMessage, ServerResponse } from 'node:http'

libs/sdk/src/server/adapters/express.host.adapter.ts
  └── import http from 'node:http'
  └── http.createServer()
```

### 3. `fs/promises` Module

**Usage:** File system operations for dev keys

| Function      | Files  | Browser Alternative |
| ------------- | ------ | ------------------- |
| `readFile()`  | 1 file | IndexedDB           |
| `writeFile()` | 1 file | IndexedDB           |
| `mkdir()`     | 1 file | Not needed          |
| `rename()`    | 1 file | Not needed          |
| `unlink()`    | 1 file | IndexedDB delete    |

**Files using fs:**

```
libs/sdk/src/auth/jwks/dev-key-persistence.ts
  └── import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises'
  └── Reads/writes: .frontmcp/dev-keys.json
```

### 4. `path` Module

**Usage:** Path manipulation

| Function       | Files  | Browser Alternative |
| -------------- | ------ | ------------------- |
| `isAbsolute()` | 1 file | Custom function     |
| `resolve()`    | 1 file | Custom function     |
| `dirname()`    | 1 file | Custom function     |

**Files using path:**

```
libs/sdk/src/auth/jwks/dev-key-persistence.ts
  └── import path from 'path'
```

### 5. `url` Module

**Usage:** URL parsing

| Import | Files   | Browser Alternative                       |
| ------ | ------- | ----------------------------------------- |
| `URL`  | 4 files | Native `URL` (already browser-compatible) |

**Files using url:**

```
libs/sdk/src/auth/instances/instance.local-primary-auth.ts
libs/sdk/src/auth/instances/instance.remote-primary-auth.ts
libs/sdk/src/auth/flows/oauth.callback.flow.ts
libs/sdk/src/common/interfaces/execution-context.interface.ts
libs/sdk/src/transport/legacy/legacy.sse.tranporter.ts
```

**Note:** The `URL` class is available natively in browsers. No change needed.

### 6. `process` Module

**Usage:** Environment variables, current working directory

| Property        | Files    | Browser Alternative |
| --------------- | -------- | ------------------- |
| `process.env`   | 8+ files | Config injection    |
| `process.cwd()` | 1 file   | Not needed          |

**Environment Variables Used:**

```
NODE_ENV              - Production vs development mode
MCP_SESSION_SECRET    - Session encryption key
JWT_SECRET            - JWT signing key
MACHINE_ID            - Machine identifier
DEBUG                 - Debug logging flag
```

**Files using process:**

```
libs/sdk/src/auth/session/transport-session.manager.ts
  └── process.env['MCP_SESSION_SECRET'], process.env['NODE_ENV']

libs/sdk/src/auth/session/utils/session-id.utils.ts
  └── process.env['MACHINE_ID'], process.env['MCP_SESSION_SECRET']

libs/sdk/src/auth/jwks/dev-key-persistence.ts
  └── process.env['NODE_ENV'], process.cwd()

libs/sdk/src/auth/instances/instance.local-primary-auth.ts
  └── process.env['JWT_SECRET']

libs/sdk/src/auth/authorization/authorization.class.ts
  └── process.env['MACHINE_ID']

libs/sdk/src/tool/flows/call-tool.flow.ts
  └── process.env['DEBUG'], process.env['NODE_ENV']

libs/sdk/src/errors/mcp.error.ts
  └── process.env['NODE_ENV']
```

---

## Third-Party Node.js Packages

### 1. `ioredis`

**Usage:** Redis client for session/store persistence

**Files:**

```
libs/sdk/src/auth/session/redis-session.store.ts
  └── import IoRedis, { Redis, RedisOptions } from 'ioredis'

libs/sdk/src/store/adapters/store.redis.adapter.ts
  └── ScopedRedisStore class
```

**Browser Alternative:** IndexedDB, localStorage, or in-memory Map

### 2. `raw-body`

**Usage:** HTTP request body parsing

**Files:**

```
libs/sdk/src/transport/legacy/legacy.sse.tranporter.ts
  └── import getRawBody from 'raw-body'
```

**Browser Alternative:** Not needed (no HTTP server)

### 3. `content-type`

**Usage:** MIME type parsing

**Files:**

```
libs/sdk/src/transport/legacy/legacy.sse.tranporter.ts
  └── import contentType from 'content-type'
```

**Browser Alternative:** Not needed (no HTTP server)

### 4. `express`

**Usage:** HTTP server framework

**Files:**

```
libs/sdk/src/server/adapters/express.host.adapter.ts
  └── import express from 'express'
  └── import cors from 'cors'
```

**Browser Alternative:** Not needed (event-based transport)

---

## Files by Category

### Core SDK (Must Fix for Browser)

These files are essential for the SDK to function and need browser-safe alternatives:

| File                                               | Dependencies    | Priority |
| -------------------------------------------------- | --------------- | -------- |
| `flows/flow.instance.ts`                           | crypto          | **HIGH** |
| `flows/flow.registry.ts`                           | crypto          | **HIGH** |
| `errors/mcp.error.ts`                              | crypto          | **HIGH** |
| `common/interfaces/execution-context.interface.ts` | crypto, url     | **HIGH** |
| `transport/transport.registry.ts`                  | crypto          | **HIGH** |
| `tool/flows/call-tool.flow.ts`                     | crypto, process | **HIGH** |

### Auth/Session (Skip for Browser)

These files handle authentication and can be excluded from browser builds:

| File                      | Dependencies              | Priority |
| ------------------------- | ------------------------- | -------- |
| `auth/session/*.ts`       | crypto, ioredis, process  | SKIP     |
| `auth/jwks/*.ts`          | crypto, fs, path, process | SKIP     |
| `auth/authorization/*.ts` | crypto, process           | SKIP     |
| `auth/flows/*.ts`         | crypto                    | SKIP     |
| `auth/instances/*.ts`     | crypto, url, process      | SKIP     |

### Transport/Server (Replace for Browser)

These files implement HTTP transport and need browser alternatives:

| File                                        | Dependencies                      | Priority |
| ------------------------------------------- | --------------------------------- | -------- |
| `transport/legacy/legacy.sse.tranporter.ts` | http, url, raw-body, content-type | REPLACE  |
| `server/adapters/express.host.adapter.ts`   | express, http, cors               | REPLACE  |

---

## Browser Compatibility Matrix

| Module       | Node.js API               | Web API                    | Status                 |
| ------------ | ------------------------- | -------------------------- | ---------------------- |
| UUID         | `crypto.randomUUID()`     | `crypto.randomUUID()`      | Native support         |
| Random bytes | `crypto.randomBytes()`    | `crypto.getRandomValues()` | Needs wrapper          |
| Hash         | `crypto.createHash()`     | `crypto.subtle.digest()`   | Needs async wrapper    |
| Cipher       | `crypto.createCipheriv()` | `crypto.subtle.encrypt()`  | Needs async wrapper    |
| URL          | `url.URL`                 | `URL`                      | Native support         |
| HTTP         | `http.createServer()`     | N/A                        | Replace with events    |
| File system  | `fs/promises`             | IndexedDB                  | Replace entirely       |
| Environment  | `process.env`             | Config object              | Replace with injection |
