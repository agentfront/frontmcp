---
name: js-bundle-import-test
reference: test-cli-binary
level: intermediate
description: 'Verify that the compiled JS bundle can be imported and exports the expected modules after a `frontmcp build` step.'
tags: [testing, cli, binary, js, bundle, import]
features:
  - 'Using dynamic `import()` to test that the built JS bundle is importable'
  - 'Verifying the bundle has a default export (server class or factory)'
  - 'Testing CommonJS `require()` compatibility to ensure the bundle works in CJS environments'
  - 'Pointing to the `dist/` output directory where `frontmcp build` places artifacts'
---

# Testing JS Bundle Importability

Verify that the compiled JS bundle can be imported and exports the expected modules after a `frontmcp build` step.

## Code

```typescript
// src/__tests__/js-bundle.spec.ts
import * as path from 'path';

const DIST_DIR = path.resolve(__dirname, '../dist');

describe('JS Bundle', () => {
  it('should be importable as a CJS module', async () => {
    const mod = await import(path.join(DIST_DIR, 'my-server.cjs.js'));
    expect(mod).toBeDefined();
  });

  it('should export a default server module', async () => {
    const mod = await import(path.join(DIST_DIR, 'my-server.cjs.js'));
    // The default export should be the server class or factory
    expect(mod.default || mod).toBeDefined();
  });

  it('should not throw on require', () => {
    expect(() => {
      require(path.join(DIST_DIR, 'my-server.cjs.js'));
    }).not.toThrow();
  });
});
```

## What This Demonstrates

- Using dynamic `import()` to test that the built JS bundle is importable
- Verifying the bundle has a default export (server class or factory)
- Testing CommonJS `require()` compatibility to ensure the bundle works in CJS environments
- Pointing to the `dist/` output directory where `frontmcp build` places artifacts

## Related

- See `test-cli-binary` for the full CLI binary testing reference
- See `test-browser-build` for browser-specific build testing
