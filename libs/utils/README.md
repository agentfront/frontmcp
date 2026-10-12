# @frontmcp/utils

Shared helpers for the FrontMCP packages: names and URI templates, cross-platform crypto, key-value storage, file system access, environment detection and more. This is an internal package: `@frontmcp/sdk` and the other `@frontmcp/*` packages depend on it and install it for you. Import it directly only when your own code, like a plugin, needs one of these helpers.

[![npm](https://img.shields.io/npm/v/@frontmcp/utils.svg)](https://www.npmjs.com/package/@frontmcp/utils) [![License](https://img.shields.io/npm/l/@frontmcp/utils.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/utils
```

It needs Node.js 24 or later. The crypto, async context, event emitter, environment and path helpers also have browser builds, picked through the package's `imports` map. `@frontmcp/lazy-zod` is a required peer dependency (it needs `zod` 4). The others are optional, one per storage backend:

| Optional peer    | Enables                                                      |
| ---------------- | ------------------------------------------------------------ |
| `ioredis`        | `createStorage({ type: 'redis' })` and `RedisStorageAdapter` |
| `@vercel/kv`     | `createStorage({ type: 'vercel-kv' })`                       |
| `@upstash/redis` | `createStorage({ type: 'upstash' })`                         |

## Usage

```ts
import { createStorage, expandUriTemplate, matchUriTemplate, sha256Hex, toCase } from '@frontmcp/utils';

matchUriTemplate('tickets://{id}/comments/{commentId}', 'tickets://T-1/comments/42');
// { id: 'T-1', commentId: '42' }

expandUriTemplate('tickets://{id}', { id: 'T-2' }); // 'tickets://T-2'
toCase(['create', 'ticket'], 'snake'); // 'create_ticket'
sha256Hex('hello world'); // 'b94d27b9...'

const storage = await createStorage({ type: 'memory' });
await storage.set('ticket:T-1', 'open', { ttlSeconds: 60 });
await storage.get('ticket:T-1'); // 'open'
```

## What's in it

| Area             | Exports                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Naming           | `splitWords`, `toCase`, `shortHash`, `ensureMaxLen`, `idFromString`                                                                                                       |
| URIs             | `isValidMcpUri`, `extractUriScheme`, `parseUriTemplate`, `matchUriTemplate`, `expandUriTemplate`, `extractTemplateParams` (RFC 3986 URIs, RFC 6570 templates)             |
| Paths            | `trimSlashes`, `joinPath`, and cross-platform `pathJoin`, `pathResolve`, `basename`, `dirname`, `extname`                                                                 |
| Content          | `sanitizeToJson`, `inferMimeType`, `safeStringify`                                                                                                                        |
| HTTP             | `validateBaseUrl`, `buildSetCookie`, `parseCookies`, `getCookie`, `isLocalhost`, `isSecureRequest`                                                                        |
| Network          | `classifyIpAddress`, `parseIpv4`, `expandIpv6`, `isRedirectResponse`, for SSRF (server-side request forgery) checks                                                       |
| Escaping         | `escapeHtml`, `escapeHtmlAttr`, `escapeJsString`, `safeJsonForScript`                                                                                                     |
| Crypto           | `sha256`, `sha256Hex`, `hmacSha256`, `hkdfSha256`, `encryptAesGcm`, `decryptAesGcm`, `randomBytes`, `randomUUID`, `timingSafeEqual`, `base64urlEncode`, `base64urlDecode` |
| PKCE             | `generateCodeVerifier`, `generateCodeChallenge`, `verifyCodeChallenge`, `generatePkcePair` (RFC 7636)                                                                     |
| Encryption, keys | `encryptValue`, `decryptValue`, `signData`, `verifyData`, `KeyPersistence`, `createKeyPersistence`                                                                        |
| Storage          | `createStorage`, `createMemoryStorage`, `TypedStorage`, `EncryptedTypedStorage`, and adapters for memory, Redis, Vercel KV, Upstash and the file system                   |
| File system      | `readFile`, `writeFile`, `mkdir`, `stat`, `fileExists`, `readJSON`, `writeJSON`, `ensureDir`, `isDirEmpty`, `runCmd` and more. Node.js only; `fs` loads on first use.     |
| Environment      | `getEnv`, `isProduction`, `isDevelopment`, `isEdgeRuntime`, `isServerless`, `getRuntimeContext`, `isNode`, `isBrowser`                                                    |
| Context, events  | `AsyncLocalStorage`, `EventEmitter`, both with browser builds                                                                                                             |
| Safe regex       | `isPatternSafe`, `createSafeRegExp`, `safeTest`, `safeMatch`, `safeReplace`, against ReDoS (regular expression denial of service)                                         |
| Model tool calls | `processPlatformToolCalls`, which passes OpenAI, Claude or Vercel AI tool calls to your `callTool` function and returns the results in that platform's format             |
| Machine ID       | `getMachineId`, `setMachineIdOverride`, `getHostname`                                                                                                                     |

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework, built on these helpers.
- [`@frontmcp/auth`](https://www.npmjs.com/package/@frontmcp/auth): uses the crypto, PKCE and storage helpers.
- [`@frontmcp/storage-sqlite`](https://www.npmjs.com/package/@frontmcp/storage-sqlite): a SQLite storage adapter that implements this package's `StorageAdapter`.

## Contributing

Source: [`libs/utils`](https://github.com/agentfront/frontmcp/tree/main/libs/utils). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
