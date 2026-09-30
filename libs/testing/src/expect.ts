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

import type { expect as JestExpect } from '@jest/globals';
import type { Matchers } from 'expect';

import type { McpMatchers } from './matchers/matcher-types';

type JestExpectType = typeof JestExpect;

let resolvedExpect: JestExpectType | undefined;

/**
 * `@jest/globals` throws when it is required outside a Jest environment, so it is resolved on first
 * use. This keeps `@frontmcp/testing` importable from plain Node scripts (token factory, mock OAuth
 * server, `TestServer`, ...); only calling `expect` outside Jest fails, and says why.
 */
function resolveJestExpect(): JestExpectType {
  if (resolvedExpect) return resolvedExpect;
  try {
    resolvedExpect = (require('@jest/globals') as { expect: JestExpectType }).expect;
    return resolvedExpect;
  } catch (error) {
    throw new Error(
      `expect() from @frontmcp/testing can only be used inside a Jest test file: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

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
  anything(): ReturnType<JestExpectType['anything']>;
  any(classType: unknown): ReturnType<JestExpectType['any']>;
  arrayContaining<E = unknown>(arr: readonly E[]): ReturnType<JestExpectType['arrayContaining']>;
  objectContaining<E = Record<string, unknown>>(obj: E): ReturnType<JestExpectType['objectContaining']>;
  stringContaining(str: string): ReturnType<JestExpectType['stringContaining']>;
  stringMatching(str: string | RegExp): ReturnType<JestExpectType['stringMatching']>;

  // expect.not
  not: {
    arrayContaining<E = unknown>(arr: readonly E[]): ReturnType<JestExpectType['not']['arrayContaining']>;
    objectContaining<E = Record<string, unknown>>(obj: E): ReturnType<JestExpectType['not']['objectContaining']>;
    stringContaining(str: string): ReturnType<JestExpectType['not']['stringContaining']>;
    stringMatching(str: string | RegExp): ReturnType<JestExpectType['not']['stringMatching']>;
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
export const expect = new Proxy(function frontmcpExpect() {}, {
  apply: (_target, thisArg, args) => Reflect.apply(resolveJestExpect(), thisArg, args),
  get: (_target, prop) => Reflect.get(resolveJestExpect(), prop),
  has: (_target, prop) => Reflect.has(resolveJestExpect(), prop),
}) as unknown as McpExpect;
