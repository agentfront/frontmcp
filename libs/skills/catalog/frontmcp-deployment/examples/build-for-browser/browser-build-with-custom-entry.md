---
name: browser-build-with-custom-entry
reference: build-for-browser
level: intermediate
description: 'Build a browser bundle using a dedicated client entry file that re-exports browser-safe `@frontmcp/react` symbols.'
tags: [deployment, browser, custom, entry]
features:
  - 'Creating a separate browser entry point (`src/client.ts`) that avoids importing Node.js-only modules like `fs` or `node:crypto`'
  - 'Re-exporting the real `@frontmcp/react` API: `FrontMcpProvider`, `useListTools`, `useListResources`, `useCallTool`'
  - 'Using the `-e` and `-o` flags to customize the entry file and output directory'
---

# Browser Build with Custom Entry

Build a browser bundle using a dedicated client entry file that avoids Node.js-only imports. Re-export the real `@frontmcp/react` symbols (`useListTools`, `useListResources`, `useCallTool`) — `useTools`/`useResources` do not exist.

## Code

```typescript
// src/client.ts
// Browser-safe entry point — no Node.js modules imported here.
export {
  FrontMcpProvider,
  useListTools,
  useListResources,
  useListPrompts,
  useCallTool,
  useReadResource,
  useGetPrompt,
} from '@frontmcp/react';
```

```bash
# Build with custom entry and output directory
frontmcp build --target browser -e ./src/client.ts -o ./dist/browser
```

```bash
# Verify output directory contents
ls dist/browser/
```

## What This Demonstrates

- Creating a separate browser entry point (`src/client.ts`) that re-exports only browser-safe symbols
- Using the real `@frontmcp/react` hook names (`useListTools`, `useListResources`, etc.)
- Using the `-e` and `-o` flags to customize the entry file and output directory

## Related

- See `build-for-browser` for the full browser limitations table and verification checklist
