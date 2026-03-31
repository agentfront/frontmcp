---
name: test-browser-build
description: Validate browser build output for Node.js-free bundles and test with Playwright
---

# Testing Browser Build

After building with `frontmcp build --target browser`, validate the output:

```typescript
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
  });

  it('should export expected functions', async () => {
    // Use dynamic import to test ESM compatibility
    const mod = await import(path.join(DIST_DIR, 'index.js'));
    expect(mod).toBeDefined();
  });
});
```

## Testing with Playwright (.pw.spec.ts)

```typescript
import { test, expect } from '@playwright/test';

test('browser MCP client loads tools', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Wait for tools to load from MCP server
  await page.waitForSelector('[data-testid="tool-list"]');

  const tools = await page.locator('[data-testid="tool-item"]').count();
  expect(tools).toBeGreaterThan(0);
});

test('browser client can call a tool', async ({ page }) => {
  await page.goto('http://localhost:3000');

  await page.fill('[data-testid="input-a"]', '5');
  await page.fill('[data-testid="input-b"]', '3');
  await page.click('[data-testid="call-tool"]');

  const result = await page.textContent('[data-testid="result"]');
  expect(result).toContain('8');
});
```

## Examples

| Example                                                                                    | Level    | Description                                                                                      |
| ------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| [`browser-bundle-validation`](../examples/test-browser-build/browser-bundle-validation.md) | Basic    | Verify that the browser build produces a valid bundle without Node.js-only module references.    |
| [`playwright-browser-test`](../examples/test-browser-build/playwright-browser-test.md)     | Advanced | Use Playwright to test a browser-based MCP client that loads and calls tools from an MCP server. |

> See all examples in [`examples/test-browser-build/`](../examples/test-browser-build/)
