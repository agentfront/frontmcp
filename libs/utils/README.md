# @frontmcp/utils

Shared utility functions for the FrontMCP ecosystem.

[![NPM](https://img.shields.io/npm/v/@frontmcp/utils.svg)](https://www.npmjs.com/package/@frontmcp/utils)

> **Internal package.** Used by `@frontmcp/sdk` and other `@frontmcp/*` libraries — most users do not need to install this directly.

## Install

```bash
npm install @frontmcp/utils
```

## Features

**Naming** — `splitWords`, `toCase`, `shortHash`, `ensureMaxLen`, `idFromString` for string manipulation and case conversion

**URI** — `isValidMcpUri`, `extractUriScheme`, `parseUriTemplate`, `matchUriTemplate`, `expandUriTemplate` (RFC 3986 / RFC 6570)

**Path** — `trimSlashes`, `joinPath` for URL path operations

**Content** — `sanitizeToJson`, `inferMimeType` for safe serialization and MIME detection

**HTTP** — `validateBaseUrl` for URL validation and normalization

**Crypto** — `sha256`, `sha256Hex`, `sha256Base64url`, `hkdfSha256`, `encryptAesGcm`, `decryptAesGcm`, `randomBytes`, `randomUUID`, `generateCodeVerifier`, `generateCodeChallenge`, `generatePkcePair`, `base64urlEncode`, `base64urlDecode` for cross-platform cryptography

**File system** — `readFile`, `writeFile`, `mkdir`, `stat`, `fileExists`, `readJSON`, `writeJSON`, `ensureDir`, `isDirEmpty`, `runCmd` and more — lazy-loaded for Node.js environments

## Quick Example

```ts
import { matchUriTemplate, sha256Hex, fileExists } from '@frontmcp/utils';

const params = matchUriTemplate('users/{id}/posts/{postId}', 'users/123/posts/456');
// { id: '123', postId: '456' }

const hash = sha256Hex('hello world');

const exists = await fileExists('/path/to/file');
```

## Related Packages

- [`@frontmcp/sdk`](../sdk) — core framework
- [`@frontmcp/auth`](../auth) — uses crypto utilities for PKCE, encryption

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
