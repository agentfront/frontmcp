---
name: browser-bundle-config
reference: production-browser
level: basic
description: 'Shows how to configure package.json for browser-compatible SDK distribution with ESM/CJS/UMD entry points, TypeScript declarations, and CDN support.'
tags: [production, browser, sdk, node, bundle, config]
features:
  - 'Correct `main`, `module`, `browser`, `types`, and `exports` fields for browser distribution'
  - 'Using the `browser` field to point bundlers to the browser-specific build'
  - 'Browser-safe imports with no Node.js-only APIs'
  - 'CDN-friendly distribution that works via `<script type="module">`'
---

# Browser SDK Bundle Configuration

Shows how to configure package.json for browser-compatible SDK distribution with ESM/CJS/UMD entry points, TypeScript declarations, and CDN support.

## Code

```jsonc
// package.json
{
  "name": "my-mcp-browser-sdk",
  "version": "1.0.0",
  "description": "Browser-compatible MCP SDK",
  "license": "MIT",

  // CJS entry
  "main": "./dist/cjs/index.js",
  // ESM entry
  "module": "./dist/esm/index.js",
  // Browser-specific entry
  "browser": "./dist/browser/index.js",
  // TypeScript declarations
  "types": "./dist/types/index.d.ts",

  // Conditional exports for bundlers
  "exports": {
    ".": {
      "browser": "./dist/browser/index.js",
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js",
      "types": "./dist/types/index.d.ts",
    },
  },

  "files": ["dist/", "README.md", "LICENSE"],

  "scripts": {
    "build": "frontmcp build --target browser",
    "analyze": "npx bundlesize",
    "test": "jest --coverage",
  },
}
```

```typescript
// src/index.ts — Browser-safe public API
// No Node.js-only imports (fs, path, child_process, net, crypto)
// All crypto uses @frontmcp/utils (wraps Web Crypto API)
import { sha256Hex, randomUUID, base64urlEncode } from '@frontmcp/utils';

export { create } from './client';
export type { McpBrowserClient, McpToolResult } from './types';

// Re-export utilities that work in the browser
export { sha256Hex, randomUUID, base64urlEncode };
```

```html
<!-- CDN usage via script tag -->
<script type="module">
  import { create } from 'https://cdn.example.com/my-mcp-browser-sdk@1.0.0/dist/browser/index.js';

  const client = await create({
    baseUrl: 'https://mcp-api.example.com',
  });

  const tools = await client.listTools();
  console.log('Available tools:', tools);
</script>
```

## What This Demonstrates

- Correct `main`, `module`, `browser`, `types`, and `exports` fields for browser distribution
- Using the `browser` field to point bundlers to the browser-specific build
- Browser-safe imports with no Node.js-only APIs
- CDN-friendly distribution that works via `<script type="module">`

## Related

- See `production-browser` for the full browser compatibility and distribution checklist
