/**
 * E2E Tests for Import Resolver via MCP
 *
 * Tests rewriteImports() wrapper tool including:
 * - Rewriting bare imports to CDN URLs
 * - Preserving relative imports
 * - Multiple package handling
 * - Subpath imports
 * - Skip packages option
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Import Resolver E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-uipack/src/main.ts',
    project: 'demo-e2e-uipack',
    publicMode: true,
  });

  test.describe('Tool Discovery', () => {
    test('should list resolve-imports tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('resolve-imports');
    });
  });

  test.describe('Basic Import Rewriting', () => {
    test('should rewrite react import to CDN URL', async ({ mcp }) => {
      const result = await mcp.tools.call('resolve-imports', {
        source: "import React from 'react';",
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ code: string; rewrittenCount: number; rewrites: Record<string, string> }>();
      expect(json.code).toContain('https://');
      expect(json.rewrittenCount).toBeGreaterThanOrEqual(1);
      expect(json.rewrites['react']).toBeDefined();
    });

    test('should preserve relative imports', async ({ mcp }) => {
      const result = await mcp.tools.call('resolve-imports', {
        source: "import { helper } from './utils';",
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ code: string; rewrittenCount: number }>();
      expect(json.code).toContain('./utils');
      expect(json.rewrittenCount).toBe(0);
    });

    test('should handle multiple packages', async ({ mcp }) => {
      const result = await mcp.tools.call('resolve-imports', {
        source: [
          "import React from 'react';",
          "import { createRoot } from 'react-dom/client';",
          "import { z } from 'zod';",
        ].join('\n'),
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ rewrittenCount: number; rewrites: Record<string, string> }>();
      expect(json.rewrittenCount).toBeGreaterThanOrEqual(2);
    });

    test('should rewrite subpath imports', async ({ mcp }) => {
      const result = await mcp.tools.call('resolve-imports', {
        source: "import { createRoot } from 'react-dom/client';",
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ code: string; rewrittenCount: number }>();
      expect(json.code).toContain('esm.sh');
      expect(json.rewrittenCount).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Skip Packages', () => {
    test('should leave skipped packages untouched', async ({ mcp }) => {
      const result = await mcp.tools.call('resolve-imports', {
        source: ["import React from 'react';", "import { z } from 'zod';"].join('\n'),
        skipPackages: ['react'],
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ code: string; rewrites: Record<string, string> }>();
      expect(json.rewrites['react']).toBeUndefined();
      // zod should still be rewritten
      expect(json.code).toContain('esm.sh');
    });
  });
});
