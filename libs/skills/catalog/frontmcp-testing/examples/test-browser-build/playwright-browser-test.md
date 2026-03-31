---
name: playwright-browser-test
reference: test-browser-build
level: advanced
description: 'Use Playwright to test a browser-based MCP client that loads and calls tools from an MCP server.'
tags: [testing, browser, playwright, e2e]
features:
  - "Using Playwright's `test` and `expect` from `@playwright/test` for browser E2E testing"
  - 'Waiting for DOM elements with `waitForSelector` before asserting tool list counts'
  - 'Filling form inputs and clicking buttons to simulate tool calls in the browser'
  - 'Asserting tool results via `textContent` on result elements'
  - 'Using the `.pw.spec.ts` file suffix required by FrontMCP naming conventions'
---

# Testing Browser MCP Client with Playwright

Use Playwright to test a browser-based MCP client that loads and calls tools from an MCP server.

## Code

```typescript
// src/__tests__/browser-client.pw.spec.ts
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

test('browser client shows error for invalid input', async ({ page }) => {
  await page.goto('http://localhost:3000');

  await page.fill('[data-testid="input-a"]', 'abc');
  await page.fill('[data-testid="input-b"]', '3');
  await page.click('[data-testid="call-tool"]');

  const error = await page.textContent('[data-testid="error-message"]');
  expect(error).toBeTruthy();
});
```

## What This Demonstrates

- Using Playwright's `test` and `expect` from `@playwright/test` for browser E2E testing
- Waiting for DOM elements with `waitForSelector` before asserting tool list counts
- Filling form inputs and clicking buttons to simulate tool calls in the browser
- Asserting tool results via `textContent` on result elements
- Using the `.pw.spec.ts` file suffix required by FrontMCP naming conventions

## Related

- See `test-browser-build` for the full browser build testing reference
- See `test-e2e-handler` for server-side E2E testing patterns
