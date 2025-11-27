/**
 * @file setup.ts
 * @description Jest setup file for @frontmcp/testing
 *
 * This file registers custom MCP matchers with Jest.
 * Include it in your Jest config's setupFilesAfterEnv:
 *
 * @example jest.config.ts
 * ```typescript
 * export default {
 *   setupFilesAfterEnv: ['@frontmcp/testing/setup'],
 * };
 * ```
 *
 * Or use the preset:
 * ```typescript
 * export default {
 *   preset: '@frontmcp/testing/jest-preset',
 * };
 * ```
 */

import { expect } from '@jest/globals';
import { mcpMatchers } from './matchers/mcp-matchers';

// Register custom matchers with Jest
expect.extend(mcpMatchers);

// Import type augmentation
import './matchers/matcher-types';
