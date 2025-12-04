/**
 * @file index.ts
 * @description Barrel exports for UI testing utilities
 *
 * @example
 * ```typescript
 * import { uiMatchers, UIAssertions } from '@frontmcp/testing';
 *
 * // Use matchers with expect.extend
 * expect.extend(uiMatchers);
 *
 * // Or use assertion helpers directly
 * const html = UIAssertions.assertRenderedUI(result);
 * ```
 */

export { uiMatchers } from './ui-matchers';
export { UIAssertions } from './ui-assertions';
