/**
 * @file expect.ts
 * @description Pre-typed expect export with MCP custom matchers
 *
 * This is the Playwright-style approach - instead of relying on global type
 * augmentation (which can be fragile across monorepos and path mappings),
 * we export a properly typed expect function that includes all MCP matchers.
 *
 * @example
 * ```typescript
 * import { test, expect } from '@frontmcp/testing';
 *
 * test('tools are available', async ({ mcp }) => {
 *   const tools = await mcp.tools.list();
 *   expect(tools).toContainTool('my-tool'); // Properly typed!
 * });
 * ```
 */

import { expect as jestExpect } from '@jest/globals';
import type { Matchers } from 'expect';
import type { McpMatchers } from './matchers/matcher-types';

/**
 * Extended Jest matchers interface that includes MCP matchers
 */
type McpExpectMatchers<R extends void | Promise<void>, T = unknown> = Matchers<R, T> &
  McpMatchers<R> & {
    /**
     * Inverts the matchers that follow
     */
    not: Matchers<R, T> & McpMatchers<R>;

    /**
     * Used to access matchers that are resolved asynchronously
     */
    resolves: Matchers<Promise<void>, T> & McpMatchers<Promise<void>>;

    /**
     * Used to access matchers that are rejected asynchronously
     */
    rejects: Matchers<Promise<void>, T> & McpMatchers<Promise<void>>;
  };

/**
 * Extended expect interface with MCP matchers
 */
interface McpExpect {
  <T = unknown>(actual: T): McpExpectMatchers<void, T>;

  // Asymmetric matchers
  anything(): ReturnType<typeof jestExpect.anything>;
  any(classType: unknown): ReturnType<typeof jestExpect.any>;
  arrayContaining<E = unknown>(arr: readonly E[]): ReturnType<typeof jestExpect.arrayContaining>;
  objectContaining<E = Record<string, unknown>>(obj: E): ReturnType<typeof jestExpect.objectContaining>;
  stringContaining(str: string): ReturnType<typeof jestExpect.stringContaining>;
  stringMatching(str: string | RegExp): ReturnType<typeof jestExpect.stringMatching>;

  // expect.not
  not: {
    arrayContaining<E = unknown>(arr: readonly E[]): ReturnType<typeof jestExpect.not.arrayContaining>;
    objectContaining<E = Record<string, unknown>>(obj: E): ReturnType<typeof jestExpect.not.objectContaining>;
    stringContaining(str: string): ReturnType<typeof jestExpect.not.stringContaining>;
    stringMatching(str: string | RegExp): ReturnType<typeof jestExpect.not.stringMatching>;
  };

  // Utilities
  extend(matchers: Record<string, unknown>): void;
  assertions(num: number): void;
  hasAssertions(): void;
}

/**
 * Pre-typed expect with MCP custom matchers included
 *
 * This approach (similar to Playwright's) provides type safety without
 * relying on global TypeScript namespace augmentation, which can be
 * problematic in monorepo setups with path mappings.
 */
export const expect = jestExpect as unknown as McpExpect;
