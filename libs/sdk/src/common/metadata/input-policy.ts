// file: libs/sdk/src/common/metadata/input-policy.ts
import { internalZ as z } from '@frontmcp/lazy-zod';

/** What `tools/call` does with argument keys `inputSchema` does not declare: drop them, also tell, or refuse the call. */
export type InputUndeclaredKeysPolicy = 'strip' | 'warn' | 'fail';

/** Input policy, declarable on `@FrontMcp`, `@App` and `@Tool`, resolved Tool > App > server > default. */
export interface InputPolicy {
  /**
   * `'strip'` drops undeclared argument keys; `'warn'` drops them, logs each once per tool and ends the answer with a
   * line naming them; `'fail'` refuses the call with `INVALID_INPUT`. Both name the closest declared key.
   *
   * @default 'fail' (up to 1.12, 'warn' when NODE_ENV is 'development', otherwise 'strip')
   */
  undeclaredKeys?: InputUndeclaredKeysPolicy;
}

export const inputPolicySchema = z.object({
  undeclaredKeys: z.enum(['strip', 'warn', 'fail']).optional(),
});

/** Resolve the undeclared-argument policy: Tool > App > server > 'fail'. */
export function resolveInputUndeclaredKeysPolicy(
  tool?: InputPolicy,
  app?: InputPolicy,
  server?: InputPolicy,
): InputUndeclaredKeysPolicy {
  return tool?.undeclaredKeys ?? app?.undeclaredKeys ?? server?.undeclaredKeys ?? 'fail';
}
