# Building for Browser

This document describes how to build FrontMCP applications for browser environments using the CLI.

## Table of Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Build Output](#build-output)
- [Environment Detection](#environment-detection)
- [Crypto API Compatibility](#crypto-api-compatibility)
- [Integration with Bundlers](#integration-with-bundlers)

---

## Quick Start

Build your FrontMCP application for browser using the `--adapter browser` flag:

```bash
# Build for browser
frontmcp build --adapter browser --outDir dist/browser

# Build for Node.js (default)
frontmcp build --adapter node --outDir dist
```

---

## How It Works

The CLI uses **esbuild** with module replacement to swap Node.js-specific modules with browser-compatible shims at build time.

### Module Replacements

| Node.js Import | Browser Replacement                     |
| -------------- | --------------------------------------- |
| `crypto`       | `@frontmcp/sdk/platform/browser-crypto` |
| `node:crypto`  | `@frontmcp/sdk/platform/browser-crypto` |
| `url`          | Native `URL` API                        |
| `buffer`       | `Uint8Array` (inline polyfill)          |

### Build-Time Constants

The build defines compile-time constants for environment detection:

| Constant                       | Browser Value | Node.js Value |
| ------------------------------ | ------------- | ------------- |
| `process.env.FRONTMCP_BROWSER` | `"true"`      | `"false"`     |

---

## Build Output

The browser build produces:

- **Format**: ES Modules (ESM)
- **Target**: ES2022 (modern browsers)
- **Platform**: Browser
- **Output**: Single bundled file with tree-shaking
- **Source Maps**: Included for debugging

### Output Structure

```
dist/browser/
├── main.js           # Bundled application
├── main.js.map       # Source map
└── index.js          # Entry point (if generated)
```

---

## Environment Detection

Use compile-time constants to write platform-specific code:

```typescript
// This code is evaluated at build time
if (process.env.FRONTMCP_BROWSER === 'true') {
  // Browser-specific code
  console.log('Running in browser');
} else {
  // Node.js-specific code (eliminated in browser builds)
  console.log('Running in Node.js');
}
```

**Important**: The condition is evaluated at build time, so the unused branch is completely eliminated from the bundle (dead code elimination).

---

## Crypto API Compatibility

The browser build includes a Web Crypto API shim that provides compatibility with Node.js crypto functions:

| Node.js Function            | Browser Implementation            |
| --------------------------- | --------------------------------- |
| `randomUUID()`              | `crypto.randomUUID()`             |
| `randomBytes(n)`            | `crypto.getRandomValues()`        |
| `createHash('sha256')`      | `crypto.subtle.digest('SHA-256')` |
| `createHmac('sha256', key)` | `crypto.subtle.sign('HMAC')`      |
| AES-GCM encryption          | `crypto.subtle.encrypt/decrypt`   |
| HKDF key derivation         | `crypto.subtle.deriveBits`        |

### Async vs Sync

**Note**: Web Crypto API is async, while Node.js crypto is sync. The browser shim returns `Promise` from `digest()` and `sign()` methods. Ensure your code handles this correctly:

```typescript
// Node.js (sync)
const hash = crypto.createHash('sha256').update(data).digest('hex');

// Browser (async) - the shim handles this
const hash = await crypto.createHash('sha256').update(data).digest('hex');
```

---

## Integration with Bundlers

The browser build output can be further processed by your application's bundler:

### Vite

```typescript
// vite.config.ts
export default {
  build: {
    rollupOptions: {
      input: 'dist/browser/main.js',
    },
  },
};
```

### Webpack

```javascript
// webpack.config.js
module.exports = {
  entry: './dist/browser/main.js',
  // ...
};
```

### Direct Import

```html
<script type="module">
  import * as app from './dist/browser/main.js';
  // Use your FrontMCP application
</script>
```

---

## SSR (Server-Side Rendering)

For SSR frameworks like Next.js or Remix, build separate bundles:

```bash
# Build server bundle (Node.js)
frontmcp build --adapter node --outDir dist/server

# Build client bundle (Browser)
frontmcp build --adapter browser --outDir dist/client
```

See [STORE.md#server-side-rendering-ssr](./STORE.md#server-side-rendering-ssr) for hydration patterns.

---

## Limitations

1. **File System Access**: `fs` and `path` modules are not available in browser
2. **HTTP Server**: The browser build cannot start an HTTP server
3. **WebWorkers**: Tools and resources run in the main thread (no automatic worker spawning)
4. **Binary Data**: Use `Uint8Array` instead of Node.js `Buffer`

---

## Troubleshooting

### "crypto is not defined"

Ensure you're using the browser adapter:

```bash
frontmcp build --adapter browser
```

### Module not found errors

Some Node.js modules are not supported in browser. Check the build warnings for unsupported modules.

### Large bundle size

Enable minification:

```bash
frontmcp build --adapter browser --minify
```

(Note: `--minify` flag is planned for future release)
