import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

/**
 * Exercises the general session secure-secret store (#470) over a real session
 * via `this.secureStore`:
 *
 *   - `set`    → store a user-typed secret under a key (scoped to the session/sub)
 *   - `get`    → read it back (returns presence + a constant redaction marker,
 *                NEVER the raw secret, so transcripts never leak it)
 *   - `list`   → the secret keys in the current scope
 *   - `delete` → remove a secret
 *
 * The tool never returns the raw secret value — only `[redacted]` + presence —
 * so the e2e can assert behavior (including persistence across sessions for the
 * sqlite backing) without leaking the secret. No PII — synthetic secrets only.
 */

const inputSchema = {
  op: z.enum(['set', 'get', 'list', 'delete']).describe('Operation to perform'),
  key: z.string().optional().describe('Secret key (required for set/get/delete)'),
  value: z.string().optional().describe('Secret value (required for set)'),
};

const outputSchema = z.object({
  op: z.string(),
  /** Whether the secret was present (get) / existed (delete). */
  present: z.boolean().optional(),
  /** Constant redaction marker — never the real secret. */
  preview: z.string().optional(),
  /** Secret keys in the current scope (list). */
  keys: z.array(z.string()).optional(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'secret',
  description: 'Set/get/list/delete a session secret via this.secureStore',
  inputSchema,
  outputSchema,
})
export default class SecretTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    switch (input.op) {
      case 'set': {
        await this.secureStore.set(input.key!, input.value!);
        return { op: 'set' };
      }
      case 'get': {
        const v = await this.secureStore.get<string>(input.key!);
        return { op: 'get', present: v !== undefined, preview: v !== undefined ? '[redacted]' : undefined };
      }
      case 'delete': {
        const existed = await this.secureStore.delete(input.key!);
        return { op: 'delete', present: existed };
      }
      case 'list':
      default: {
        const keys = await this.secureStore.list();
        return { op: 'list', keys };
      }
    }
  }
}
