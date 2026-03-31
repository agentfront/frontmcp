---
name: package-json-config
reference: production-node-sdk
level: intermediate
description: 'Shows the correct package.json configuration for publishing a FrontMCP SDK package with CJS + ESM entry points, peer dependencies, and proper file inclusions.'
tags: [production, sdk, readme, node, package, json]
features:
  - 'Correct `main`, `module`, `types`, and `exports` fields for CJS + ESM'
  - 'Using `files` to include only `dist/`, `README.md`, and `LICENSE` in the published package'
  - 'Declaring `zod` as a `peerDependency` for shared packages'
  - 'The `prepublishOnly` script ensuring build and tests pass before publishing'
  - 'Integration test verifying the full lifecycle with proper cleanup'
---

# npm Package Configuration for SDK Publishing

Shows the correct package.json configuration for publishing a FrontMCP SDK package with CJS + ESM entry points, peer dependencies, and proper file inclusions.

## Code

```jsonc
// package.json
{
  "name": "my-mcp-sdk",
  "version": "1.0.0",
  "description": "MCP SDK for task management with type-safe tool invocations",
  "keywords": ["mcp", "sdk", "task-management", "frontmcp"],
  "license": "MIT",

  // CJS + ESM entry points
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js",
      "types": "./dist/types/index.d.ts",
    },
  },

  // Only ship what consumers need
  "files": ["dist/", "README.md", "LICENSE"],

  // Required Node.js version
  "engines": {
    "node": ">=18.0.0",
  },

  // Shared dependencies as peerDependencies
  "peerDependencies": {
    "zod": "^4.0.0",
  },

  "dependencies": {
    "@frontmcp/sdk": "^1.0.0",
  },

  "devDependencies": {
    "@frontmcp/testing": "^1.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.4.0",
    "zod": "^4.0.0",
  },

  "scripts": {
    "build": "frontmcp build",
    "test": "jest --coverage",
    "prepublishOnly": "npm run build && npm test",
  },
}
```

```typescript
// test/lifecycle.spec.ts — Integration test for the full lifecycle
import { create } from '../src/index';

describe('SDK lifecycle', () => {
  it('should complete create -> connect -> callTool -> close -> dispose', async () => {
    const server = await create();
    const client = await server.connect();

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    const result = await client.callTool('my_tool', { input: 'test' });
    expect(result).toBeDefined();

    // Always clean up — tests must not leak resources
    await client.close();
    await server.dispose();
  });
});
```

## What This Demonstrates

- Correct `main`, `module`, `types`, and `exports` fields for CJS + ESM
- Using `files` to include only `dist/`, `README.md`, and `LICENSE` in the published package
- Declaring `zod` as a `peerDependency` for shared packages
- The `prepublishOnly` script ensuring build and tests pass before publishing
- Integration test verifying the full lifecycle with proper cleanup

## Related

- See `production-node-sdk` for the full npm publishing and testing checklist
