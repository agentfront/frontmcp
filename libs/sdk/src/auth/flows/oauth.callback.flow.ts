/**
 * OAuth Callback Endpoint — GET /oauth/callback
 *
 * Who calls: Browser after user completes login form
 *
 * When: After the user submits the login form from /oauth/authorize
 *
 * Purpose: Creates an authorization code and redirects back to the client's redirect_uri
 *
 * Notes: This is a simple "demo" login callback. In production, this would integrate
 * with a real identity provider or user database.
 */

import {
  createFederatedAuthSession,
  escapeHtml,
  renderLocalLoginPage,
  startNextProvider,
  type AuthenticateContext,
  type AuthenticateResult,
  type LoginConfig,
  type LoginRenderContext,
  type ProviderPkce,
} from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';
import { generateCodeVerifier, randomUUID, sha256Base64url, sha256Hex } from '@frontmcp/utils';

import {
  Flow,
  FlowBase,
  HttpHtmlSchema,
  httpInputSchema,
  HttpRedirectSchema,
  httpRespond,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  // From query params
  pendingAuthId: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  // From pending authorization record
  clientId: z.string().optional(),
  redirectUri: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  codeChallenge: z.string().optional(),
  originalState: z.string().optional(),
  resource: z.string().optional(),
  // Generated
  authorizationCode: z.string().optional(),
  userSub: z.string().optional(),
  // Checkpoint 3a — custom verification (authenticate()) results.
  // Submitted login fields (built-in email/name + any custom `login.fields`).
  loginFields: z.record(z.string(), z.string()).optional(),
  // Custom claims returned by authenticate(), embedded (namespaced) in the token.
  customClaims: z.record(z.string(), z.unknown()).optional(),
  // Checkpoint 3b — credentials returned by authenticate(), persisted into the
  // per-session credential vault keyed by the minted userSub at code-mint time.
  credentials: z
    .array(
      z.object({
        key: z.string(),
        secret: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  // Progressive/Incremental Authorization
  isIncremental: z.boolean().default(false),
  targetAppId: z.string().optional(),
  targetToolId: z.string().optional(),
  existingSessionId: z.string().optional(),
  existingAuthorizationId: z.string().optional(),
  // Federated Login
  isFederated: z.boolean().default(false),
  selectedProviders: z.array(z.string()).optional(),
  skippedProviders: z.array(z.string()).optional(),
  // Consent
  consentEnabled: z.boolean().default(false),
  selectedTools: z.array(z.string()).optional(),
});

const outputSchema = z.union([HttpRedirectSchema, HttpHtmlSchema]);

const plan = {
  pre: ['parseInput', 'validatePendingAuth'],
  execute: ['handleIncrementalAuth', 'handleFederatedAuth', 'createAuthorizationCode', 'redirectToClient'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'oauth:callback': FlowRunOptions<
      OauthCallbackFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'oauth:callback' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'GET',
    path: '/oauth/callback',
  },
})
export default class OauthCallbackFlow extends FlowBase<typeof name> {
  private logger = this.scope.logger.child('OauthCallbackFlow');

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;

    // Extract login form data from query params
    const pendingAuthId = request.query['pending_auth_id'] as string | undefined;
    const email = request.query['email'] as string | undefined;
    const name = request.query['name'] as string | undefined;

    // Checkpoint 3a — gather all submitted login fields (email/name + any custom
    // `login.fields`) for a configured authenticate() verifier. Values come from
    // the GET query and, defensively, a urlencoded POST body. Reserved OAuth
    // control params are excluded so they can't masquerade as login fields.
    const loginFields = this.collectLoginFields(request);

    // Progressive/Incremental Authorization Parameters
    const isIncremental = request.query['incremental'] === 'true';
    const targetAppId = request.query['app_id'] as string | undefined;

    // Federated Login Parameters
    const isFederated = request.query['federated'] === 'true';
    // providers can be array (multiple checkboxes) or string (single)
    const providersParam = request.query['providers'];
    let selectedProviders: string[] | undefined;
    if (providersParam) {
      selectedProviders = Array.isArray(providersParam) ? providersParam : [providersParam];
    }

    // Consent Parameters (from POST body or query)
    // Note: For consent, we might use POST, but GET is also supported
    const toolsParam = request.query['tools'];
    let selectedTools: string[] | undefined;
    if (toolsParam) {
      selectedTools = Array.isArray(toolsParam) ? toolsParam : [toolsParam];
    }

    this.state.set({
      pendingAuthId,
      email,
      name,
      isIncremental,
      targetAppId,
      isFederated,
      selectedProviders,
      selectedTools,
      loginFields,
    });

    if (isIncremental) {
      this.logger.info(`Incremental auth callback for app: ${targetAppId}`);
    }

    if (isFederated) {
      this.logger.info(`Federated login callback with ${selectedProviders?.length || 0} selected providers`);
    }

    if (selectedTools && selectedTools.length > 0) {
      this.logger.info(`Consent callback with ${selectedTools.length} selected tools`);
    }
  }

  @Stage('validatePendingAuth')
  async validatePendingAuth() {
    const { pendingAuthId, email, isIncremental, isFederated, selectedProviders, selectedTools, loginFields } =
      this.state;

    if (!pendingAuthId) {
      this.logger.warn('Missing pending_auth_id in callback');
      this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Missing pending_auth_id parameter'), 400));
      return;
    }

    // Retrieve the pending authorization
    const localAuth = this.scope.auth as LocalPrimaryAuth;

    // Checkpoint 3a — a configured custom `authenticate` verifier takes over the
    // login-completion decision. When it is set, the built-in email requirement
    // no longer applies (the verifier owns required-field semantics via
    // `login.fields`).
    const localOptions = localAuth.options as {
      requireEmail?: boolean;
      anonymousSubject?: string;
      login?: LoginConfig;
      authenticate?: (
        input: { fields: Record<string, string> },
        ctx: AuthenticateContext,
      ) => Promise<AuthenticateResult>;
    };
    const authenticateFn = typeof localOptions.authenticate === 'function' ? localOptions.authenticate : undefined;

    // #468 — email opt-out for single-operator local setups.
    // `requireEmail` defaults to true (historical behavior). When explicitly
    // false, a non-incremental login without an email is allowed and the code
    // is minted against a stable anonymous subject (see createAuthorizationCode
    // below). For incremental auth email was never required. A custom
    // `authenticate` verifier bypasses this check entirely.
    const requireEmail = localOptions.requireEmail ?? true;
    if (!authenticateFn && !isIncremental && !email && requireEmail) {
      this.logger.warn('Missing email in callback');
      this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Email is required'), 400));
      return;
    }

    const pendingAuth = await localAuth.authorizationStore.getPendingAuthorization(pendingAuthId);

    if (!pendingAuth) {
      this.logger.warn(`Pending authorization not found or expired: ${pendingAuthId}`);
      this.respond(
        httpRespond.html(
          this.renderErrorPage('invalid_request', 'Authorization request has expired. Please try again.'),
          400,
        ),
      );
      return;
    }

    // Generate a user sub from email (in production, this would come from a user database)
    // For incremental auth, we might need to use existing session's user sub.
    // #468 — when email is opted out (requireEmail=false) and none was provided
    // for a non-incremental login, derive a STABLE anonymous sub from the
    // configured subject so the single operator keeps a consistent identity and
    // a code can still be minted (createAuthorizationCode requires userSub).
    let userSub: string | undefined;
    if (email) {
      userSub = this.generateUserSub(email);
    } else if (!isIncremental && !requireEmail) {
      const anonymousSubject = localOptions.anonymousSubject ?? 'local-operator';
      userSub = this.generateUserSub(anonymousSubject);
    } else {
      userSub = undefined;
    }

    // Checkpoint 3a — run the custom verifier (non-incremental logins only).
    // On success, derive the subject (explicit `sub` → subject strategy → the
    // anonymous fallback) and stash custom claims for the minted token. On
    // failure, re-render the login page with the error instead of proceeding.
    if (authenticateFn && !isIncremental) {
      const result = await this.runAuthenticate(authenticateFn, loginFields ?? {}, pendingAuth);
      if (!result.ok) {
        // Keep the pending auth alive so the user can retry on the re-rendered page.
        this.respond(
          httpRespond.html(this.renderLoginRetryPage(pendingAuth, localOptions.login, loginFields ?? {}, result)),
        );
        return;
      }
      userSub =
        result.sub ??
        this.deriveSubjectFromStrategy(localOptions.login, loginFields ?? {}) ??
        this.generateUserSub(localOptions.anonymousSubject ?? 'local-operator');
      if (result.claims) {
        this.state.set('customClaims', result.claims);
      }
      // Checkpoint 3b — stash credentials returned by authenticate() so they can
      // be persisted into the per-session vault keyed by the minted userSub at
      // code-mint time (createAuthorizationCode). Each credential is validated to
      // have a string key + secret; malformed entries are dropped.
      if (Array.isArray(result.credentials) && result.credentials.length > 0) {
        const creds = result.credentials.filter(
          (c): c is { key: string; secret: string; metadata?: Record<string, unknown> } =>
            !!c && typeof c.key === 'string' && typeof c.secret === 'string',
        );
        if (creds.length > 0) {
          this.state.set('credentials', creds);
        }
      }
    }

    // Validate federated login is enabled for this authorization request
    if (isFederated && !pendingAuth.federatedLogin) {
      this.logger.warn('Federated login not enabled for this authorization request');
      this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Federated login not enabled'), 400));
      return;
    }

    // Calculate skipped providers from federated login
    let skippedProviders: string[] | undefined;
    if (isFederated && pendingAuth.federatedLogin) {
      // Gate JWT issuance on the configured threshold. When top-level
      // `auth.providers` are declared, the default minimum is 1 ("no JWT until
      // ≥1 linked"); `federatedAuth.minProviders` raises it. The app-level
      // federation path (no configured providers) keeps the historical ≥1 rule.
      const federatedConfig = (
        localAuth.options as { federatedAuth?: { minProviders?: number; requiredProviders?: string[] } }
      ).federatedAuth;
      // Default minimum is 1 in both the configured-providers and the legacy
      // app-level federation paths (historical "≥1 selected" behavior).
      const minProviders = federatedConfig?.minProviders ?? 1;
      const requiredProviders = federatedConfig?.requiredProviders ?? [];

      const selected = selectedProviders ?? [];

      // Refuse to mint a token until the minimum number of providers is linked.
      if (selected.length < minProviders) {
        this.logger.warn(`Insufficient federated providers selected: ${selected.length} < ${minProviders}`);
        this.respond(
          httpRespond.html(
            this.renderErrorPage(
              'invalid_request',
              `At least ${minProviders} provider${minProviders === 1 ? '' : 's'} must be linked`,
            ),
            400,
          ),
        );
        return;
      }

      const allProviders = pendingAuth.federatedLogin.providerIds;

      // Validate selectedProviders against allowed providerIds
      const invalidProviders = selected.filter((id) => !allProviders.includes(id));
      if (invalidProviders.length > 0) {
        this.logger.warn(`Invalid provider IDs: ${invalidProviders.join(', ')}`);
        this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Invalid provider selection'), 400));
        return;
      }

      // Require every explicitly-required provider to be among the selected set.
      const missingRequired = requiredProviders.filter((id) => !selected.includes(id));
      if (missingRequired.length > 0) {
        this.logger.warn(`Missing required providers: ${missingRequired.join(', ')}`);
        this.respond(
          httpRespond.html(
            this.renderErrorPage('invalid_request', `Required provider(s) not linked: ${missingRequired.join(', ')}`),
            400,
          ),
        );
        return;
      }

      skippedProviders = allProviders.filter((id) => !selected.includes(id));
    }

    // Get consent state
    const consentEnabled = pendingAuth.consent?.enabled ?? false;
    const availableToolIds = pendingAuth.consent?.availableToolIds ?? [];

    if (consentEnabled && selectedTools) {
      const invalidToolIds = selectedTools.filter((toolId) => !availableToolIds.includes(toolId));
      if (invalidToolIds.length > 0) {
        this.logger.warn(`Invalid consent tool selection: ${invalidToolIds.join(', ')}`);
        this.respond(
          httpRespond.html(
            this.renderErrorPage(
              'invalid_request',
              'Invalid tool selection. Please restart authorization and choose from the available tools.',
            ),
            400,
          ),
        );
        return;
      }
    }

    // If consent was enabled and user submitted selection, use it; otherwise use all available
    const finalSelectedTools = consentEnabled && selectedTools ? selectedTools : availableToolIds;

    this.state.set({
      clientId: pendingAuth.clientId,
      redirectUri: pendingAuth.redirectUri,
      scopes: pendingAuth.scopes,
      codeChallenge: pendingAuth.pkce.challenge,
      originalState: pendingAuth.state,
      resource: pendingAuth.resource,
      userSub,
      // Progressive/Incremental Authorization from pending record
      isIncremental: pendingAuth.isIncremental || isIncremental,
      targetAppId: pendingAuth.targetAppId || this.state.targetAppId,
      targetToolId: pendingAuth.targetToolId,
      existingSessionId: pendingAuth.existingSessionId,
      existingAuthorizationId: pendingAuth.existingAuthorizationId,
      // Federated Login
      isFederated: isFederated || !!pendingAuth.federatedLogin,
      selectedProviders: selectedProviders,
      skippedProviders: skippedProviders,
      // Consent
      consentEnabled,
      selectedTools: finalSelectedTools,
    });

    // Clean up the pending authorization
    await localAuth.authorizationStore.deletePendingAuthorization(pendingAuthId);
  }

  /**
   * Handle incremental authorization - expand existing session's token vault
   * For incremental auth, we add the app to the existing authorization without
   * requiring full re-authentication
   */
  @Stage('handleIncrementalAuth')
  async handleIncrementalAuth() {
    const { isIncremental, targetAppId, existingAuthorizationId, redirectUri } = this.state;

    // Skip if not incremental auth
    if (!isIncremental || !targetAppId) {
      return;
    }

    this.logger.info(`Processing incremental authorization for app: ${targetAppId}`);

    // For incremental auth, we need to:
    // 1. Validate the existing session (if provided)
    // 2. Generate a special incremental auth code that includes the app ID
    // 3. The token endpoint will then expand the authorization

    // For now, we pass the incremental auth info through the authorization code
    // The token exchange will handle expanding the authorization

    // Store incremental auth metadata for the token exchange
    // This will be encoded in the authorization code or stored separately
    this.logger.info(
      `Incremental auth prepared for app: ${targetAppId}, existing auth: ${existingAuthorizationId || 'none'}`,
    );
  }

  /**
   * Handle federated authentication - start provider chain
   * When user selects providers on federated login page, we need to:
   * 1. Create a federated session to track progress
   * 2. Start OAuth flow with the first selected provider
   * 3. Chain through remaining providers
   */
  @Stage('handleFederatedAuth')
  async handleFederatedAuth() {
    const {
      isFederated,
      selectedProviders,
      email,
      name,
      userSub,
      codeChallenge,
      clientId,
      redirectUri,
      scopes,
      originalState,
      resource,
    } = this.state;

    // Skip if not federated auth or no providers selected
    if (!isFederated || !selectedProviders || selectedProviders.length === 0) {
      return;
    }

    // For federated auth, we need to create a session and start the provider chain
    // instead of immediately creating an authorization code
    this.logger.info(`Starting federated auth with ${selectedProviders.length} providers`);

    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const sessionStore = localAuth.federatedSessionStore;

    if (
      !sessionStore ||
      typeof sessionStore.store !== 'function' ||
      typeof sessionStore.update !== 'function' ||
      typeof sessionStore.delete !== 'function'
    ) {
      this.logger.error('Federated session store not configured');
      this.respond(
        httpRespond.html(this.renderErrorPage('server_error', 'Federated authentication not configured'), 500),
      );
      return;
    }

    // Validate required fields
    if (!codeChallenge || !clientId || !redirectUri) {
      this.logger.error('Missing required fields for federated auth');
      this.respond(httpRespond.html(this.renderErrorPage('server_error', 'Authorization request incomplete'), 500));
      return;
    }

    // Create federated session using type-safe factory function
    const federatedSession = createFederatedAuthSession({
      pendingAuthId: this.state.required.pendingAuthId || randomUUID(),
      clientId,
      redirectUri,
      scopes: scopes ?? [],
      state: originalState,
      resource,
      userInfo: {
        email,
        name,
        sub: userSub,
      },
      frontmcpPkce: {
        challenge: codeChallenge,
        method: 'S256',
      },
      providerIds: selectedProviders,
    });

    // Store the session
    await sessionStore.store(federatedSession);
    this.logger.info(`Created federated session: ${federatedSession.id}`);

    // Get first provider and start OAuth flow
    const firstProviderId = selectedProviders[0];

    // Generate PKCE for the provider
    const verifier = generateCodeVerifier();
    const challenge = sha256Base64url(verifier);
    const pkce: ProviderPkce = {
      verifier,
      challenge,
      method: 'S256',
    };

    // Generate state for provider
    const providerState = `federated:${federatedSession.id}:${randomUUID()}`;

    // Start the provider in the session
    startNextProvider(federatedSession, pkce, providerState);

    // Update session with current provider info
    await sessionStore.update(federatedSession);

    // Build redirect URL to first provider
    const providerConfig = localAuth.getProviderConfig(firstProviderId);
    if (!providerConfig) {
      // Provider not configured yet - clean up session and fall back to normal auth
      this.logger.warn(`Provider ${firstProviderId} not configured, falling back to normal auth`);
      await sessionStore.delete(federatedSession.id);
      this.state.set({
        isFederated: false,
        selectedProviders: undefined,
        skippedProviders: undefined,
      });
      return;
    }

    const redirectUrl = await localAuth.buildProviderAuthorizeUrl(firstProviderId, {
      state: providerState,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
    });

    if (!redirectUrl) {
      this.logger.error(`Failed to build authorize URL for provider: ${firstProviderId}`);
      await sessionStore.delete(federatedSession.id);
      this.respond(
        httpRespond.html(
          this.renderErrorPage('server_error', `Failed to initiate auth with provider: ${firstProviderId}`),
          500,
        ),
      );
      return;
    }

    this.logger.info(`Redirecting to first provider: ${firstProviderId}`);
    this.respond(httpRespond.redirect(redirectUrl));
  }

  @Stage('createAuthorizationCode')
  async createAuthorizationCode() {
    // Read from the non-throwing state proxy: only clientId/redirectUri/codeChallenge/userSub
    // are truly required (validated explicitly below). The rest are optional, and reading an
    // undefined optional field off `state.required` throws InvokeStateMissingKeyError → a 500
    // on every non-federated local login (no `resource`/`name`/`selectedProviders`/…).
    const {
      clientId,
      redirectUri,
      scopes,
      codeChallenge,
      originalState,
      resource,
      email,
      name,
      userSub,
      // Consent and Federated Login
      consentEnabled,
      selectedTools,
      isFederated,
      selectedProviders,
      skippedProviders,
      // Checkpoint 3a — custom claims from authenticate()
      customClaims,
      // Checkpoint 3b — credentials from authenticate()
      credentials,
    } = this.state;

    // Validate required fields before creating authorization code
    if (!clientId || !redirectUri || !codeChallenge || !userSub) {
      const missingFields = [
        !clientId && 'clientId',
        !redirectUri && 'redirectUri',
        !codeChallenge && 'codeChallenge',
        !userSub && 'userSub',
      ].filter(Boolean);
      this.logger.error(`Missing required fields for authorization code: ${missingFields.join(', ')}`);
      this.respond(
        httpRespond.html(
          this.renderErrorPage('server_error', 'Authorization request is incomplete. Please try again.'),
          500,
        ),
      );
      return;
    }

    const localAuth = this.scope.auth as LocalPrimaryAuth;

    // Create the authorization code with consent/federated data
    const code = await localAuth.createAuthorizationCode({
      clientId,
      redirectUri,
      scopes: scopes ?? [],
      codeChallenge,
      userSub,
      userEmail: email,
      userName: name,
      state: originalState,
      resource,
      // Consent and Federated Login Data
      selectedToolIds: selectedTools,
      selectedProviderIds: selectedProviders,
      skippedProviderIds: skippedProviders,
      consentEnabled: consentEnabled,
      federatedLoginUsed: isFederated,
      // Checkpoint 3a — custom claims to embed (namespaced) in the access token.
      customClaims,
    });

    this.logger.info(
      `Authorization code created for user: ${userSub}${
        consentEnabled ? ` with ${selectedTools?.length || 0} selected tools` : ''
      }${isFederated ? ` (federated with ${selectedProviders?.length || 0} providers)` : ''}`,
    );
    this.state.set('authorizationCode', code);

    // Checkpoint 3b — persist authenticate() credentials into the per-session
    // credential vault, keyed by the SAME userSub baked into the minted token.
    // rotateVault() mints a fresh vaultId first so a reconnect starts EMPTY
    // (prior ciphertext becomes undecryptable). Best-effort: a vault failure
    // must not break the login (the code is already minted).
    if (credentials && credentials.length > 0) {
      const vault = localAuth.credentialVault;
      if (vault) {
        try {
          const vaultId = await vault.rotateVault(userSub);
          for (const cred of credentials) {
            await vault.store(userSub, vaultId, cred.key, { secret: cred.secret, metadata: cred.metadata });
          }
          this.logger.info(`Persisted ${credentials.length} credential(s) to the session vault`);
        } catch (err) {
          this.logger.error(
            `Failed to persist authenticate() credentials: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        this.logger.warn('authenticate() returned credentials but no credential vault is configured; ignoring');
      }
    }
  }

  @Stage('redirectToClient')
  async redirectToClient() {
    // Read from the non-throwing state proxy: redirectUri/authorizationCode are validated
    // explicitly below; originalState/targetAppId are optional and reading them off
    // `state.required` throws InvokeStateMissingKeyError when a client omits the OAuth
    // `state` param or it's a non-incremental login (same bug class as #466).
    const { redirectUri, authorizationCode, originalState, isIncremental, targetAppId } = this.state;

    // Validate required fields for redirect
    if (!redirectUri || !authorizationCode) {
      this.logger.error('Missing redirectUri or authorizationCode for redirect');
      this.respond(
        httpRespond.html(
          this.renderErrorPage('server_error', 'Failed to complete authorization. Please try again.'),
          500,
        ),
      );
      return;
    }

    // Build the redirect URL with the authorization code
    const url = new URL(redirectUri);
    url.searchParams.set('code', authorizationCode);
    if (originalState) {
      url.searchParams.set('state', originalState);
    }

    // For incremental auth, include the app ID in the redirect
    // This allows the client to know which app was just authorized
    if (isIncremental && targetAppId) {
      url.searchParams.set('incremental', 'true');
      url.searchParams.set('app_id', targetAppId);
    }

    this.logger.info(
      `Redirecting to client: ${url.origin}${url.pathname}${
        isIncremental ? ` (incremental for app: ${targetAppId})` : ''
      }`,
    );
    this.respond(httpRespond.redirect(url.toString()));
  }

  /**
   * Reserved OAuth/flow control params that must never be treated as custom
   * login fields when collecting input for a custom `authenticate` verifier.
   */
  private static readonly RESERVED_LOGIN_PARAMS = new Set<string>([
    'pending_auth_id',
    'incremental',
    'app_id',
    'federated',
    'providers',
    'tools',
    'csrf',
    'action',
    'app',
    'state',
    'code',
    'redirect_uri',
    'client_id',
    'response_type',
    'code_challenge',
    'code_challenge_method',
    'scope',
    'resource',
  ]);

  /**
   * Collect submitted login-field values (built-in `email`/`name` plus any
   * custom `login.fields`) from the GET query and a urlencoded POST body.
   * Reserved OAuth/flow control params are excluded so they cannot be forwarded
   * to the verifier as if they were login fields. Only string values are kept.
   */
  private collectLoginFields(request: { query?: Record<string, unknown>; body?: unknown }): Record<string, string> {
    const fields: Record<string, string> = {};
    const absorb = (source: Record<string, unknown> | undefined) => {
      if (!source || typeof source !== 'object') return;
      for (const [key, value] of Object.entries(source)) {
        if (OauthCallbackFlow.RESERVED_LOGIN_PARAMS.has(key)) continue;
        if (typeof value === 'string') {
          fields[key] = value;
        } else if (Array.isArray(value) && typeof value[0] === 'string') {
          // Multi-valued field (e.g. duplicate query keys) — keep the first.
          fields[key] = value[0];
        }
      }
    };
    absorb(request.query as Record<string, unknown> | undefined);
    // Defensive: some adapters parse a urlencoded POST body into request.body.
    if (request.body && typeof request.body === 'object' && !Array.isArray(request.body)) {
      absorb(request.body as Record<string, unknown>);
    }
    return fields;
  }

  /**
   * Build the {@link AuthenticateContext} from the flow scope and invoke the
   * configured verifier. Verifier exceptions are caught and converted to a
   * generic failure so a throwing verifier never produces a 500.
   */
  private async runAuthenticate(
    authenticateFn: (
      input: { fields: Record<string, string> },
      ctx: AuthenticateContext,
    ) => Promise<AuthenticateResult>,
    fields: Record<string, string>,
    pendingAuth: { clientId: string },
  ): Promise<AuthenticateResult> {
    const clientName = await this.resolveClientName(pendingAuth.clientId);
    const ctx: AuthenticateContext = {
      get: <T>(token: unknown): T => this.get(token as Parameters<typeof this.get>[0]) as T,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => this.contextFetch(input, init),
      logger: this.scope.logger.child('authenticate'),
      clientId: pendingAuth.clientId,
      clientName,
    };

    try {
      const result = await authenticateFn({ fields }, ctx);
      if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
        this.logger.error('authenticate() returned a malformed result');
        return { ok: false, message: 'Authentication failed. Please try again.' };
      }
      return result;
    } catch (err) {
      // A throwing verifier must not crash the flow — reject cleanly and let the
      // user retry. The detailed error is logged server-side only.
      this.logger.error(`authenticate() threw: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, message: 'Authentication failed. Please try again.' };
    }
  }

  /**
   * Outbound fetch handed to the verifier. Routes through the auth instance's
   * `fetch` when available (so tests / adapters can intercept it), else the
   * global fetch.
   */
  private contextFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const auth = this.scope.auth as { fetch?: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
    if (typeof auth?.fetch === 'function') {
      return auth.fetch(input, init);
    }
    return fetch(input, init);
  }

  /**
   * Resolve a human-readable client name for the verifier context. Uses the
   * CIMD `client_name` when the client_id is a CIMD URL and resolvable; falls
   * back to the raw client_id.
   */
  private async resolveClientName(clientId: string): Promise<string> {
    try {
      const localAuth = this.scope.auth as {
        cimdService?: {
          enabled?: boolean;
          isCimdClientId?: (id: string) => boolean;
          resolveClientMetadata?: (id: string) => Promise<{ metadata?: { client_name?: string } }>;
        };
      };
      const cimd = localAuth.cimdService;
      if (cimd?.enabled && cimd.isCimdClientId?.(clientId) && cimd.resolveClientMetadata) {
        const resolution = await cimd.resolveClientMetadata(clientId);
        if (resolution?.metadata?.client_name) return resolution.metadata.client_name;
      }
    } catch {
      // Best-effort only; fall back to the client_id.
    }
    return clientId;
  }

  /**
   * Derive a subject from the configured login subject strategy.
   *
   * - `per-account`: hash the value of `login.subject.fromField` into a stable
   *   subject (same account → same `sub`).
   * - otherwise (`per-session` / unset): return undefined so the caller falls
   *   back to the anonymous subject.
   */
  private deriveSubjectFromStrategy(
    login: LoginConfig | undefined,
    fields: Record<string, string>,
  ): string | undefined {
    const subject = login?.subject;
    if (subject?.strategy === 'per-account' && subject.fromField) {
      const seed = fields[subject.fromField];
      if (seed) return this.generateUserSub(seed);
    }
    return undefined;
  }

  /**
   * Re-render the local login page after a failed authenticate(), surfacing the
   * verifier's message (and pre-selecting `retryField`). Submitted values are
   * preserved on the form so the user does not have to re-enter everything.
   */
  private renderLoginRetryPage(
    pendingAuth: { clientId: string; scopes: string[] },
    login: LoginConfig | undefined,
    fields: Record<string, string>,
    failure: { message: string; retryField?: string },
  ): string {
    const callbackPath = `${this.scope.fullPath}/oauth/callback`;
    const ctx: LoginRenderContext = {
      clientId: pendingAuth.clientId,
      clientName: pendingAuth.clientId,
      scopes: pendingAuth.scopes ?? [],
      pendingAuthId: this.state.required.pendingAuthId,
      callbackPath,
      fields: login?.fields ?? {},
      error: failure.message,
    };
    return renderLocalLoginPage(login, ctx, fields);
  }

  /**
   * Generate a stable user sub from email
   * In production, this would be the user's ID from the database
   */
  private generateUserSub(email: string): string {
    // Create a deterministic UUID from the email for demo purposes
    // In production, this would be the actual user ID
    const hash = sha256Hex(email.toLowerCase());
    // Format as UUID
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  /**
   * Render an error page
   */
  private renderErrorPage(error: string, description: string): string {
    // Escape user-provided content to prevent XSS attacks
    const safeError = escapeHtml(error);
    const safeDescription = escapeHtml(description);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .error-container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      max-width: 500px;
      text-align: center;
    }
    .error-icon { font-size: 48px; margin-bottom: 20px; }
    h1 { color: #e53e3e; margin-bottom: 10px; }
    p { color: #666; line-height: 1.6; }
    .error-code { font-family: monospace; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; }
    .retry-link {
      display: inline-block;
      margin-top: 20px;
      color: #667eea;
      text-decoration: none;
    }
    .retry-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">⚠️</div>
    <h1>Authorization Error</h1>
    <p><span class="error-code">${safeError}</span></p>
    <p>${safeDescription}</p>
    <a href="javascript:history.back()" class="retry-link">← Go Back</a>
  </div>
</body>
</html>`;
  }
}
