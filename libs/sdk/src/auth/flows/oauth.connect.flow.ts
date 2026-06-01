/**
 * OAuth Connect Endpoint — GET|POST /oauth/connect (Checkpoint 3b)
 *
 * Mid-session add-credential flow reached via a FRAMEWORK-SIGNED resume URL that
 * `this.credentials.requireConnect({ key })` hands back when a credential is not
 * connected.
 *
 *   - GET  /oauth/connect?token=…  → verify the signed token, render a single
 *     add-credential field (reusing the 3a `login.fields` render surface).
 *   - POST /oauth/connect          → re-verify the token, re-invoke the
 *     configured `authenticate({ fields, resume: { sub, key, context } })`
 *     verifier, and ADDITIVELY store the returned credential into the user's
 *     EXISTING vault. Refuses when there is no live vault (never mints a new one)
 *     so a stale link cannot resurrect a rotated-away session.
 *
 * This is auth-internal: it lives on the existing OAuth flow surface (registered
 * by LocalPrimaryAuth), not via the public custom-route feature.
 */

import {
  buildConnectPage,
  buildConnectSuccessPage,
  escapeHtml,
  toLoginExtraFields,
  verifyCredentialResumeToken,
  type AuthenticateContext,
  type AuthenticateResult,
  type CredentialResumePayload,
  type LoginConfig,
  type LoginFieldConfig,
} from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import {
  Flow,
  FlowBase,
  HttpHtmlSchema,
  httpInputSchema,
  httpRespond,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
  type ServerRequest,
} from '../../common';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  /** HTTP method ('GET' renders the form; 'POST' processes the submission). */
  method: z.string().optional(),
  /** The framework-signed resume token (from query on GET, body on POST). */
  token: z.string().optional(),
  /** Submitted field values (POST): the single credential field. */
  fields: z.record(z.string(), z.string()).optional(),
});

const outputSchema = HttpHtmlSchema;

const plan = {
  pre: ['parseInput'],
  execute: ['handleConnect'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'oauth:connect': FlowRunOptions<
      OauthConnectFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'oauth:connect' as const;
const Stage = StageHookOf(name);

/** Reserved params that must never be treated as the credential field value. */
const RESERVED_CONNECT_PARAMS = new Set<string>(['token', 'csrf', 'action']);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    // No `method` → matches both GET (render) and POST (submit).
    path: '/oauth/connect',
  },
})
export default class OauthConnectFlow extends FlowBase<typeof name> {
  private logger = this.scope.logger.child('OauthConnectFlow');

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    const method = (request.method ?? 'GET').toUpperCase();

    // Token comes from the query on GET and from the body (or query) on POST.
    const queryToken = typeof request.query['token'] === 'string' ? (request.query['token'] as string) : undefined;
    const body = this.coerceBody(request);
    const bodyToken = typeof body['token'] === 'string' ? (body['token'] as string) : undefined;

    const fields = this.collectFields(request, body);

    this.state.set({ method, token: bodyToken ?? queryToken, fields });
  }

  @Stage('handleConnect')
  async handleConnect() {
    const { method, token, fields } = this.state;

    if (!token) {
      this.respond(httpRespond.html(this.renderError('invalid_request', 'Missing or invalid connect token.'), 400));
      return;
    }

    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const payload = this.verifyToken(token, localAuth);
    if (!payload) {
      this.respond(
        httpRespond.html(
          this.renderError('invalid_token', 'This connect link is invalid or has expired. Please try again.'),
          400,
        ),
      );
      return;
    }

    const localOptions = localAuth.options as {
      login?: LoginConfig;
      authenticate?: (
        input: { fields: Record<string, string>; resume?: { sub: string; key: string; context?: string } },
        ctx: AuthenticateContext,
      ) => Promise<AuthenticateResult>;
    };

    // GET → render the single-field add-credential page.
    if (method !== 'POST') {
      this.respond(httpRespond.html(this.renderConnectPage(payload, localOptions.login, token)));
      return;
    }

    // POST → re-invoke authenticate() with the resume context, then additively
    // store the returned credential into the EXISTING vault.
    const authenticateFn = typeof localOptions.authenticate === 'function' ? localOptions.authenticate : undefined;
    if (!authenticateFn) {
      this.respond(
        httpRespond.html(this.renderError('server_error', 'Credential connect is not configured on this server.'), 500),
      );
      return;
    }

    const result = await this.runAuthenticate(authenticateFn, fields ?? {}, payload);
    if (!result.ok) {
      // Re-render the connect page with the verifier's error.
      this.respond(httpRespond.html(this.renderConnectPage(payload, localOptions.login, token, result.message), 200));
      return;
    }

    const credentials = Array.isArray(result.credentials) ? result.credentials : [];
    if (credentials.length === 0) {
      this.respond(
        httpRespond.html(this.renderError('invalid_request', 'No credential was returned. Please try again.'), 400),
      );
      return;
    }

    const vault = localAuth.credentialVault;
    if (!vault) {
      this.respond(httpRespond.html(this.renderError('server_error', 'Credential storage is not configured.'), 500));
      return;
    }

    // Refuse when there is NO live vault for the subject — a mid-session connect
    // must ADD to an existing session, never resurrect a rotated-away one.
    const vaultId = await vault.getVaultId(payload.sub);
    if (!vaultId) {
      this.logger.warn('Connect attempted with no live vault for subject; refusing');
      this.respond(
        httpRespond.html(
          this.renderError('invalid_request', 'Your session is no longer active. Please sign in again.'),
          409,
        ),
      );
      return;
    }

    // Additively store the returned credential(s) into the existing vault.
    let stored = 0;
    for (const cred of credentials) {
      if (!cred || typeof cred.key !== 'string' || typeof cred.secret !== 'string') continue;
      await vault.store(payload.sub, vaultId, cred.key, { secret: cred.secret, metadata: cred.metadata });
      stored++;
    }
    this.logger.info(`Connected ${stored} credential(s) mid-session for key "${payload.key}"`);

    // Fire a resources/updated notification when applicable (best-effort). This
    // lets connected clients know session-scoped resources may have changed.
    this.notifyResourcesUpdated(payload.key);

    this.respond(httpRespond.html(buildConnectSuccessPage({ key: payload.key })));
  }

  // ============================================
  // Helpers
  // ============================================

  /** Verify the signed resume token against the server secret (constant-time + expiry). */
  private verifyToken(token: string, localAuth: LocalPrimaryAuth): CredentialResumePayload | null {
    const secret = new TextDecoder().decode(localAuth.secret);
    return verifyCredentialResumeToken(token, secret);
  }

  /** Resolve the single credential field to render from `login.fields` (first field), or a default. */
  private resolveConnectField(login: LoginConfig | undefined, key: string): { name: string; def: LoginFieldConfig } {
    const fields = login?.fields ?? {};
    const entries = Object.entries(fields);
    if (entries.length > 0) {
      const [name, def] = entries[0];
      return { name, def };
    }
    // Default: a password input named after the credential key.
    return { name: key, def: { type: 'password', label: key, required: true, placeholder: 'Enter value' } };
  }

  /** Render the single-field connect page (reusing the login field renderer). */
  private renderConnectPage(
    payload: CredentialResumePayload,
    login: LoginConfig | undefined,
    token: string,
    error?: string,
  ): string {
    const { name, def } = this.resolveConnectField(login, payload.key);
    const action = `${this.scope.fullPath}/oauth/connect`;
    const [field] = toLoginExtraFields({ [name]: def });
    return buildConnectPage({
      token,
      field,
      action,
      title: login?.title ?? `Connect ${payload.key}`,
      subtitle: login?.subtitle,
      logoUri: login?.logoUri,
      error,
    });
  }

  /**
   * Build the {@link AuthenticateContext} and invoke the verifier with the resume
   * context. A throwing verifier is converted into a clean failure.
   */
  private async runAuthenticate(
    authenticateFn: (
      input: { fields: Record<string, string>; resume?: { sub: string; key: string; context?: string } },
      ctx: AuthenticateContext,
    ) => Promise<AuthenticateResult>,
    fields: Record<string, string>,
    payload: CredentialResumePayload,
  ): Promise<AuthenticateResult> {
    const ctx: AuthenticateContext = {
      get: <T>(token: unknown): T => this.get(token as Parameters<typeof this.get>[0]) as T,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => this.contextFetch(input, init),
      logger: this.scope.logger.child('authenticate'),
    };
    try {
      const result = await authenticateFn(
        { fields, resume: { sub: payload.sub, key: payload.key, context: payload.context } },
        ctx,
      );
      if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
        return { ok: false, message: 'Could not connect the credential. Please try again.' };
      }
      return result;
    } catch (err) {
      this.logger.error(`authenticate() threw during connect: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, message: 'Could not connect the credential. Please try again.' };
    }
  }

  /** Outbound fetch handed to the verifier (routes through the auth instance when available). */
  private contextFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const auth = this.scope.auth as { fetch?: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
    if (typeof auth?.fetch === 'function') {
      return auth.fetch(input, init);
    }
    return fetch(input, init);
  }

  /** Fire a `notifications/resources/updated` to connected sessions (best-effort). */
  private notifyResourcesUpdated(key: string): void {
    try {
      const scope = this.scope as unknown as {
        notifyResourcesUpdated?: (uri: string) => void;
        resources?: { notifyUpdated?: (uri: string) => void };
      };
      const uri = `credential://${encodeURIComponent(key)}`;
      if (typeof scope.notifyResourcesUpdated === 'function') {
        scope.notifyResourcesUpdated(uri);
      } else if (typeof scope.resources?.notifyUpdated === 'function') {
        scope.resources.notifyUpdated(uri);
      }
    } catch {
      // Best-effort only — never fail the connect on a notification error.
    }
  }

  /** Parse a urlencoded/JSON POST body into a flat record. */
  private coerceBody(request: ServerRequest): Record<string, unknown> {
    const body: unknown = request.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    if (typeof body === 'string' && body.length > 0) {
      const trimmed = body.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const json: unknown = JSON.parse(trimmed);
          if (json && typeof json === 'object' && !Array.isArray(json)) return json as Record<string, unknown>;
        } catch {
          // fall through to urlencoded
        }
      }
      if (trimmed.includes('=') || trimmed.includes('&')) {
        const params = new URLSearchParams(trimmed);
        const out: Record<string, string> = {};
        for (const [k, v] of params) out[k] = v;
        return out;
      }
    }
    return {};
  }

  /** Collect submitted credential field values from query + body (excluding reserved params). */
  private collectFields(request: ServerRequest, body: Record<string, unknown>): Record<string, string> {
    const fields: Record<string, string> = {};
    const absorb = (source: Record<string, unknown> | undefined) => {
      if (!source) return;
      for (const [k, v] of Object.entries(source)) {
        if (RESERVED_CONNECT_PARAMS.has(k)) continue;
        if (typeof v === 'string') fields[k] = v;
        else if (Array.isArray(v) && typeof v[0] === 'string') fields[k] = v[0];
      }
    };
    absorb(request.query as Record<string, unknown>);
    absorb(body);
    return fields;
  }

  /** Render a small error page (escaped). */
  private renderError(error: string, description: string): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Connect Error</title></head>
<body style="font-family:-apple-system,sans-serif;padding:40px;text-align:center">
<h1 style="color:#e53e3e">Connect Error</h1>
<p><code>${escapeHtml(error)}</code></p>
<p>${escapeHtml(description)}</p>
</body></html>`;
  }
}
