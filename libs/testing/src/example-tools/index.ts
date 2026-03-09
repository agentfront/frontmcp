/**
 * @file example-tools/index.ts
 * @description Barrel export for example tool configurations.
 *
 * These configurations provide consistent test fixtures for platform E2E testing.
 *
 * @example
 * ```typescript
 * import {
 *   BASIC_UI_TOOL_CONFIG,
 *   FULL_UI_TOOL_CONFIG,
 *   generateBasicUIToolOutput,
 *   EXPECTED_OPENAI_TOOL_CALL_META_KEYS,
 * } from '@frontmcp/testing';
 * ```
 */

// Tool configurations
export {
  BASIC_UI_TOOL_CONFIG,
  FULL_UI_TOOL_CONFIG,
  basicUIToolInputSchema,
  basicUIToolOutputSchema,
  fullUIToolInputSchema,
  fullUIToolOutputSchema,
} from './tool-configs';

// Execution helpers
export { generateBasicUIToolOutput, generateFullUIToolOutput } from './tool-configs';

// Expected meta keys
export {
  EXPECTED_OPENAI_TOOLS_LIST_META_KEYS,
  EXPECTED_OPENAI_TOOL_CALL_META_KEYS,
  EXPECTED_EXTAPPS_TOOLS_LIST_META_KEYS,
  EXPECTED_EXTAPPS_TOOL_CALL_META_KEYS,
  EXPECTED_GENERIC_TOOLS_LIST_META_KEYS,
  EXPECTED_GENERIC_TOOL_CALL_META_KEYS,
} from './tool-configs';
