---
name: browser-bundle-validation
reference: test-browser-build
level: basic
description: 'Verify that the browser build produces a valid bundle without Node.js-only module references.'
tags: [testing, browser, node, bundle, validation]
features:
  - 'Checking that the browser build output directory contains `.js` files'
  - 'Scanning the bundle for Node.js-only `require()` calls that would break in browsers'
  - 'Using dynamic `import()` to verify the bundle is loadable'
  - 'Targeting the `dist/browser/` directory where `frontmcp build --target browser` places output'
---

# Validating Browser Build Output

Verify that the browser build produces a valid bundle without Node.js-only module references.

## Code

```typescript
// src/__tests__/browser-build.spec.ts
import * as fs from 'fs';
import * as path from 'path';

const DIST_DIR = path.resolve(__dirname, '../dist/browser');

describe('Browser Build', () => {
  it('should produce browser-compatible bundle', () => {
    const files = fs.readdirSync(DIST_DIR);
    expect(files.some((f) => f.endsWith('.js'))).toBe(true);
  });

  it('should not contain Node.js-only modules', () => {
    const bundle = fs.readFileSync(path.join(DIST_DIR, 'index.js'), 'utf-8');
    // These should be polyfilled or excluded
    expect(bundle).not.toContain("require('fs')");
    expect(bundle).not.toContain("require('child_process')");
    expect(bundle).not.toContain("require('net')");
    expect(bundle).not.toContain("require('cluster')");
  });

  it('should export expected functions', async () => {
    const mod = await import(path.join(DIST_DIR, 'index.js'));
    expect(mod).toBeDefined();
  });
});
```

## What This Demonstrates

- Checking that the browser build output directory contains `.js` files
- Scanning the bundle for Node.js-only `require()` calls that would break in browsers
- Using dynamic `import()` to verify the bundle is loadable
- Targeting the `dist/browser/` directory where `frontmcp build --target browser` places output

## Related

- See `test-browser-build` for the full browser build testing reference
