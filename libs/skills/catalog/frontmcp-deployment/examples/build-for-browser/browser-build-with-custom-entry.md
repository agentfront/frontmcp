---
name: browser-build-with-custom-entry
reference: build-for-browser
level: intermediate
description: 'Build a browser bundle using a dedicated client entry file that avoids Node.js-only imports.'
tags: [deployment, browser, node, custom, entry]
features:
  - 'Creating a separate browser entry point (`src/client.ts`) that avoids importing Node.js-only modules like `fs` or `node:crypto`'
  - 'Using the `-e` and `-o` flags to customize the entry file and output directory'
---

# Browser Build with Custom Entry

Build a browser bundle using a dedicated client entry file that avoids Node.js-only imports.

## Code

```typescript
// src/client.ts
// Browser-safe entry point - no Node.js modules imported here
import { FrontMcpProvider, useTools, useResources } from '@frontmcp/react';

export { FrontMcpProvider, useTools, useResources };
```

```bash
# Build with custom entry and output directory
frontmcp build --target browser -e ./src/client.ts -o ./dist/browser
```

```bash
# Verify output contains no Node.js-only modules
ls dist/browser/
```

## What This Demonstrates

- Creating a separate browser entry point (`src/client.ts`) that avoids importing Node.js-only modules like `fs` or `node:crypto`
- Using the `-e` and `-o` flags to customize the entry file and output directory

## Related

- See `build-for-browser` for the full browser limitations table and verification checklist
