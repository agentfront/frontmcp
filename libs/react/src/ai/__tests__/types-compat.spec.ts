import type { FormattedToolResult as SdkResult } from '@frontmcp/sdk';
import type { FormattedToolResult as ReactResult } from '../types';

// Compile-time drift guard: every SDK result must be assignable to the React type.
// If the SDK type adds a new union member that React's type doesn't cover,
// this assignment will fail at compile time.
type _AssertSdkExtendsReact = SdkResult extends ReactResult ? true : never;
const _sdkCheck: _AssertSdkExtendsReact = true;

describe('FormattedToolResult type compatibility', () => {
  it('SDK type is assignable to React type (compile-time guard)', () => {
    expect(_sdkCheck).toBe(true);
  });
});
