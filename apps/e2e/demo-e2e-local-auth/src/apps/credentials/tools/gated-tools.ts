import { Tool, ToolContext, z } from '@frontmcp/sdk';

/**
 * Tools exercising the TOOL-LEVEL `authProviders` credential gate.
 *
 * Neither tool reads a credential inside execute(); each just returns a marker
 * proving execute() RAN. The framework gate (`checkToolCredentials`) must abort
 * BEFORE execute() when a required provider's credential is not connected for
 * the session — so for `globex` (absent at login) the call is rejected with an
 * MCP -32001 error, while for `acme` (persisted by authenticate()) it executes.
 *
 * Availability is resolved through the per-session credential vault
 * (`this.credentials`), the accessor wired in `auth.mode: 'local'`. No secrets
 * are returned (no PII) — only an `ok` marker.
 */

const outputSchema = z.object({ ok: z.literal(true), provider: z.string() });
type Output = z.infer<typeof outputSchema>;

/** Requires `acme` — present after login → executes. */
@Tool({
  name: 'gated-acme',
  description: 'Runs only when the per-session "acme" credential is connected',
  inputSchema: {},
  outputSchema,
  authProviders: ['acme'],
})
export class GatedAcmeTool extends ToolContext {
  async execute(): Promise<Output> {
    return { ok: true, provider: 'acme' };
  }
}

/** Requires `globex` — absent at login → gate aborts before execute. */
@Tool({
  name: 'gated-globex',
  description: 'Requires the "globex" credential; should be gated when not connected',
  inputSchema: {},
  outputSchema,
  authProviders: [{ name: 'globex', required: true }],
})
export class GatedGlobexTool extends ToolContext {
  async execute(): Promise<Output> {
    // Reached only if globex is connected (e.g. via mid-session connect flow).
    return { ok: true, provider: 'globex' };
  }
}

/** Declares `globex` as OPTIONAL — never gated, always executes. */
@Tool({
  name: 'gated-optional',
  description: 'Declares globex as optional (required:false) — must never be gated',
  inputSchema: {},
  outputSchema,
  authProviders: [{ name: 'globex', required: false }],
})
export class GatedOptionalTool extends ToolContext {
  async execute(): Promise<Output> {
    return { ok: true, provider: 'optional' };
  }
}
