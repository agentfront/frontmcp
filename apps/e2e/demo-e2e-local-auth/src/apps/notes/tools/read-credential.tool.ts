import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

/**
 * Exercises the per-session credential vault (Checkpoint 3b) over a real session:
 *
 *   - `this.credentials.get(key)` reads a credential a local `authenticate()`
 *     verifier persisted during login.
 *   - `this.credentials.requireConnect({ key })` returns a framework-signed
 *     resume URL when the requested credential is NOT present.
 *
 * The tool never returns the raw secret — only a redacted preview + presence —
 * so the e2e can assert behavior without leaking the secret into transcripts.
 */

const inputSchema = {
  key: z.string().describe('Credential key to read'),
  requireConnect: z.boolean().optional().describe('When true, return a connect URL if the credential is absent'),
};

const outputSchema = z.object({
  present: z.boolean(),
  /** Redacted preview (first 3 chars + length) — never the full secret. */
  preview: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Credential keys available in the session vault. */
  keys: z.array(z.string()),
  /** Set when requireConnect was requested and the credential was absent. */
  connectUrl: z.string().optional(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'read-credential',
  description: 'Read a per-session credential via this.credentials',
  inputSchema,
  outputSchema,
})
export default class ReadCredentialTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const keys = await this.credentials.list();

    if (input.requireConnect) {
      const res = await this.credentials.requireConnect({ key: input.key });
      if (!res.connected) {
        return { present: false, keys, connectUrl: res.resumeUrl };
      }
      return {
        present: true,
        preview: redact(res.credential.secret),
        metadata: res.credential.metadata,
        keys,
      };
    }

    const cred = await this.credentials.get(input.key);
    if (!cred) {
      return { present: false, keys };
    }
    return { present: true, preview: redact(cred.secret), metadata: cred.metadata, keys };
  }
}

/** Redact a secret to a short, non-reversible preview. */
function redact(secret: string): string {
  return `${secret.slice(0, 3)}…(${secret.length})`;
}
