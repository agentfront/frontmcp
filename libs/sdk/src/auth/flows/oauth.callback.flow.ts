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
  buildToolConsentPage,
  createFederatedAuthSession,
  escapeHtml,
  renderLocalLoginPage,
  startNextProvider,
  type AuthenticateContext,
  type AuthenticateResult,
  type ConsentConfig,
  type ConsentHiddenField,
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
  isOrchestratedMode,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { authUiExtraPath, buildAuthUiPage, buildConsentState, type AuthTool, type AuthUiRegistry } from '../auth-ui';
import { projectConsentTools } from '../consent-tools.helper';
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
  /** Prior `authorized_apps` claim carried forward on an incremental authorize. */
  priorAuthorizedAppIds: z.array(z.string()).optional(),
  /**
   * The final app-id grant to embed as the minted token's `authorized_apps`
   * claim. Computed by `handleIncrementalAuth` ONLY when incremental auth is
   * enabled; left undefined otherwise so no claim is emitted (preserving the
   * historical allow-all behavior).
   */
  authorizedAppIds: z.array(z.string()).optional(),
  // Federated Login
  isFederated: z.boolean().default(false),
  selectedProviders: z.array(z.string()).optional(),
  skippedProviders: z.array(z.string()).optional(),
  // Consent
  consentEnabled: z.boolean().default(false),
  selectedTools: z.array(z.string()).optional(),
  // True when the consent form was submitted (distinguishes an empty selection
  // from a first visit so an empty `requireSelection` submit doesn't loop).
  consentSubmitted: z.boolean().default(false),
  // Anti-CSRF token echoed by a custom `@AuthUi` page (#469). Verified against
  // the token persisted on the pending record when present.
  csrf: z.string().optional(),
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
    // Tools can be read from either the query (GET) or a urlencoded POST body
    // (the consent form POSTs back here). `selectedTools` stays `undefined`
    // until the consent form is submitted.
    const toolsParam = request.query['tools'] ?? this.readBodyParam(request, 'tools');
    let selectedTools: string[] | undefined;
    if (toolsParam) {
      selectedTools = Array.isArray(toolsParam) ? toolsParam : [toolsParam];
    }

    // `consent_submitted` distinguishes "the user submitted the consent form
    // with zero tools checked" (marker present, `selectedTools` empty) from
    // "consent screen not yet shown" (marker absent). Without it an empty
    // submit is indistinguishable from a first visit and would loop.
    const consentSubmitted =
      request.query['consent_submitted'] === '1' || this.readBodyParam(request, 'consent_submitted') === '1';

    // Anti-CSRF token echoed by a custom `@AuthUi` page (#469). Read from query
    // (GET round-trip) or a urlencoded POST body.
    const csrfRaw = request.query['csrf'] ?? this.readBodyParam(request, 'csrf');
    const csrf = typeof csrfRaw === 'string' ? csrfRaw : Array.isArray(csrfRaw) ? csrfRaw[0] : undefined;

    this.state.set({
      pendingAuthId,
      email,
      name,
      isIncremental,
      targetAppId,
      isFederated,
      selectedProviders,
      selectedTools,
      consentSubmitted,
      loginFields,
      csrf,
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
    const {
      pendingAuthId,
      email,
      name,
      isIncremental,
      isFederated,
      selectedProviders,
      selectedTools,
      consentSubmitted,
      loginFields,
    } = this.state;

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
      consent?: ConsentConfig;
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

    // CSRF gate (#469): a custom `@AuthUi` page persisted a CSRF token on the
    // pending record. The submit MUST echo a matching token. This applies ONLY
    // to the auth-UI form path — built-in pages set no `authUiCsrf`, so existing
    // flows / e2es are unaffected. A consent re-render from a custom page keeps
    // the SAME pending id + token, so the resubmit still validates.
    if (pendingAuth.authUiCsrf) {
      const submitted = this.state.csrf;
      if (!submitted || !timingSafeEqualStr(pendingAuth.authUiCsrf, submitted)) {
        this.logger.warn('Auth-UI CSRF token mismatch on callback');
        this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Invalid or missing CSRF token'), 400));
        return;
      }
    }

    // CSRF defense-in-depth for the BUILT-IN login/consent submission. The
    // built-in pages are served by THIS server and submit back to
    // `/oauth/callback`, so a legitimate submission is always same-origin.
    // A cross-site login-CSRF/fixation attempt carries the attacker page's
    // `Origin` (set by the browser, unforgeable by script), so we reject a
    // state-changing submission whose present `Origin`/`Referer` names a
    // different host. This backstops the built-in path, which — unlike the
    // custom `@AuthUi` path above — carries no browser-bound CSRF token yet.
    // (When neither header is present we do NOT block, to avoid breaking
    // header-stripped GET navigations; the complete fix additionally embeds a
    // per-request token in the built-in login form — see security notes.)
    if (this.isCrossOriginSubmission()) {
      this.logger.warn('Cross-origin login submission rejected (CSRF)');
      this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Cross-origin request blocked'), 400));
      return;
    }

    // Generate a user sub from email (in production, this would come from a user database)
    // For incremental auth, we might need to use existing session's user sub.
    // #468 — when email is opted out (requireEmail=false) and none was provided
    // for a non-incremental login, derive a STABLE anonymous sub from the
    // configured subject so the single operator keeps a consistent identity and
    // a code can still be minted (createAuthorizationCode requires userSub).
    //
    // Progressive/Incremental authorization: an incremental authorize is for an
    // ALREADY-authenticated user, so it must reuse that stable identity rather
    // than re-running login. With the single-operator local model the identity
    // is the configured anonymous subject (the same value the operator's initial
    // login derived), so we derive it here too when no email is supplied. This
    // keeps the expanded token's `sub` identical to the original session's.
    let userSub: string | undefined;
    if (email) {
      userSub = this.generateUserSub(email);
    } else if (!requireEmail || isIncremental) {
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

    // ----- Consent gate -----
    // Get consent state from the pending record (set by the authorize flow) and
    // the consent config (flags) from the local auth options.
    const consentEnabled = pendingAuth.consent?.enabled ?? false;
    const consentConfig = localOptions.consent;
    const excludedTools = consentConfig?.excludedTools ?? [];
    // The offerable set = what the authorize flow stored (already excludes
    // `excludedTools`). Excluded tools are always available and never required.
    const availableToolIds = pendingAuth.consent?.availableToolIds ?? [];

    // Federated logins mint in the provider-callback flow AFTER all providers
    // are linked; consent for federated is shown there (or routed back here with
    // a selection). So the callback only runs the consent gate for the
    // non-federated, non-incremental local login path.
    const effectiveFederated = isFederated || !!pendingAuth.federatedLogin;
    const consentGateApplies = consentEnabled && !effectiveFederated && !isIncremental;

    // `rememberConsent` (default true): reuse a prior per-(user, client) tool
    // selection so a returning user is not re-prompted unless a NEW tool appeared.
    const rememberConsent = consentConfig?.rememberConsent ?? true;

    let finalSelectedTools = availableToolIds;
    // True when a remembered selection lets us skip the consent screen entirely
    // (it is already reconciled against the current available set, so Step 2
    // validation/requireSelection is bypassed for this minting pass).
    let rememberSkip = false;

    // Step 0 (rememberConsent): on a first visit (no submission yet), consult the
    // remembered record for this (user, client).
    if (consentGateApplies && rememberConsent && userSub && !consentSubmitted && selectedTools === undefined) {
      const remembered = await localAuth.consentStore.get(userSub, pendingAuth.clientId);
      if (remembered) {
        const seen = new Set(remembered.seenToolIds);
        const hasNewTool = availableToolIds.some((id) => !seen.has(id));
        if (!hasNewTool) {
          // No new tools since the last consent → SKIP the screen and mint with
          // the remembered selection narrowed to what is still available (+ the
          // always-available excludedTools, merged below).
          const stillSelected = remembered.selectedToolIds.filter((id) => availableToolIds.includes(id));
          this.logger.info('rememberConsent: prior selection reused — skipping consent screen');
          // The reconciled selection (+ always-available excludedTools) is what
          // gets written into state.selectedTools by the final state.set below.
          finalSelectedTools = [...new Set([...stillSelected, ...excludedTools])];
          rememberSkip = true;
        } else {
          // A new tool appeared → re-render the screen PRE-FILLED with the
          // remembered selection so the user decides about the new one (a newly
          // added tool is never silently granted).
          this.logger.info('rememberConsent: new tool detected — re-prompting pre-filled with prior selection');
          this.respond(
            httpRespond.html(
              this.renderConsentScreen(
                pendingAuth,
                consentConfig,
                { email, name, loginFields },
                undefined,
                remembered.selectedToolIds,
              ),
            ),
          );
          return;
        }
      }
    }

    // Step 1: consent enabled but the user has not yet submitted a selection →
    // render the consent screen. Do NOT delete the pending authorization; the
    // consent form GETs back to this same endpoint with the identity + `tools=`.
    if (consentGateApplies && !rememberSkip && !consentSubmitted && selectedTools === undefined) {
      this.logger.info('Consent enabled and not yet submitted — rendering consent screen');
      // Custom `@AuthUi({ slot: 'consent' })` renderer takes over when registered.
      if (await this.tryRenderCustomConsent(pendingAuth, consentConfig)) return;
      this.respond(
        httpRespond.html(this.renderConsentScreen(pendingAuth, consentConfig, { email, name, loginFields })),
      );
      return;
    }

    // Step 2: a selection was submitted (or consent is disabled / auto).
    if (consentGateApplies && !rememberSkip) {
      const submitted = selectedTools ?? [];

      // Reject any tool id that was not offered (excluded tools are never valid
      // selections — they are always available without being selected).
      const invalidToolIds = submitted.filter((toolId) => !availableToolIds.includes(toolId));
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

      // `requireSelection` (default true): an empty submit is rejected by
      // re-rendering the consent screen with an error instead of minting a
      // token with zero tools. The pending authorization is kept alive.
      const requireSelection = consentConfig?.requireSelection ?? true;
      if (requireSelection && submitted.length === 0) {
        this.logger.info('Consent submitted with no tools selected — re-rendering with requireSelection error');
        this.respond(
          httpRespond.html(
            this.renderConsentScreen(
              pendingAuth,
              consentConfig,
              { email, name, loginFields },
              'Please select at least one tool to continue.',
            ),
          ),
        );
        return;
      }

      // Persist the selection so a later login for the same (user, client) can
      // reuse it (rememberConsent). `seenToolIds` records the full offered set so
      // a newly-added tool re-prompts instead of being silently granted. No PII
      // is stored — only the opaque subject, client id, and tool ids.
      if (rememberConsent && userSub) {
        try {
          await localAuth.consentStore.set({
            userSub,
            clientId: pendingAuth.clientId,
            selectedToolIds: submitted,
            seenToolIds: availableToolIds,
            updatedAt: Date.now(),
          });
        } catch (err) {
          // Remembering is best-effort: a store failure must not block minting.
          this.logger.warn('rememberConsent: failed to persist selection', err);
        }
      }

      // The minted token's consent set is the user's selection PLUS the always
      // available `excludedTools` (which are enforced as allowed at call time).
      finalSelectedTools = [...new Set([...submitted, ...excludedTools])];
    }

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
      priorAuthorizedAppIds: pendingAuth.priorAuthorizedAppIds,
      // Federated Login
      isFederated: effectiveFederated,
      selectedProviders: selectedProviders,
      skippedProviders: skippedProviders,
      // Consent
      consentEnabled,
      selectedTools: finalSelectedTools,
    });

    // Clean up the pending authorization (only now that we are proceeding to
    // mint — the consent-render branches above return WITHOUT deleting it).
    await localAuth.authorizationStore.deletePendingAuthorization(pendingAuthId);
  }

  /**
   * Compute the progressive/incremental authorization grant for the minted
   * token (the `authorized_apps` claim).
   *
   * EXPANSION model (claim-based, enforceable — mirrors how consent/federated
   * grants already work in this codebase): the authorized-app set lives in the
   * minted token's `authorized_apps` claim, which `checkToolAuthorization`
   * enforces. Both the initial login and an incremental authorize mint a token
   * via the normal code exchange; the difference is the computed grant:
   *
   *  - INITIAL login: grant = the apps the client requested via `apps=`
   *    (`priorAuthorizedAppIds`); if none requested, grant ALL scope apps (a
   *    plain login keeps working for everything).
   *  - INCREMENTAL authorize (`mode=incremental&app=B`): grant = the prior apps
   *    (carried forward via `apps=`) UNION the newly-authorized `targetAppId`.
   *    So after authorizing app B, a `tools/call` on B's tool succeeds while app
   *    A keeps working — WITHOUT re-authorizing A.
   *
   * This stage ONLY emits a grant when `incrementalAuth.enabled` is true for an
   * orchestrated scope. When incremental auth is disabled or the scope is not
   * orchestrated, it leaves `authorizedAppIds` undefined → NO `authorized_apps`
   * claim is minted → NO app-level gating (the historical allow-all behavior is
   * preserved exactly). Federated logins mint their token in the provider
   * callback flow, so this stage is a no-op for them.
   *
   * Unknown app ids (not present in the scope) are dropped so a client can never
   * forge a grant to a non-existent app; app-level gating is per-real-app, so a
   * bogus id is harmless anyway.
   */
  @Stage('handleIncrementalAuth')
  async handleIncrementalAuth() {
    const { isIncremental, isFederated, targetAppId, existingAuthorizationId, priorAuthorizedAppIds } = this.state;

    // Federated logins mint elsewhere (provider-callback flow) — nothing to do.
    if (isFederated) {
      return;
    }

    // App-level grants are an orchestrated-mode feature gated by
    // `incrementalAuth.enabled`. When the scope is not orchestrated, or the flag
    // is explicitly disabled, emit NO grant (no claim → no gating, as before).
    const authOptions = this.scope.auth?.options;
    if (!authOptions || !isOrchestratedMode(authOptions)) {
      return;
    }
    const incrementalConfig = (authOptions as { incrementalAuth?: { enabled?: boolean } }).incrementalAuth;
    // Incremental auth is OPT-IN: only emit a grant when explicitly enabled.
    // (The schema default is `enabled: true`, but that default only applies once
    // an `incrementalAuth` block is present; a scope with no block at all stays
    // allow-all so existing orchestrated servers are unaffected.)
    if (!incrementalConfig || incrementalConfig.enabled === false) {
      return;
    }

    // Validate ids against the REAL scope app ids. The tool-owner id used by
    // `checkToolAuthorization` is `app.id`, so the claim must carry `app.id`
    // values (falling back to metadata.id for parity).
    const knownAppIds = new Set(
      this.scope.apps.getApps().map((a) => {
        const app = a as { id?: string; metadata?: { id?: string } };
        return app.id ?? app.metadata?.id ?? '';
      }),
    );

    const prior = (priorAuthorizedAppIds ?? []).filter((id) => knownAppIds.has(id));

    let grant: string[];
    if (isIncremental && targetAppId) {
      if (!knownAppIds.has(targetAppId)) {
        this.logger.warn(`Incremental auth: target app "${targetAppId}" is not a known app — ignoring expansion`);
        // Fall back to the prior grant (still a valid, enforceable set).
        grant = prior;
      } else {
        grant = Array.from(new Set([...prior, targetAppId]));
      }
      this.logger.info(
        `Incremental auth: granting [${grant.join(', ')}] (target "${targetAppId}")` +
          `${existingAuthorizationId ? ` (existing auth: ${existingAuthorizationId})` : ''}`,
      );
    } else {
      // Initial login: grant the requested apps, or ALL scope apps when the
      // client did not narrow the set (a plain login keeps working everywhere).
      grant = priorAuthorizedAppIds ? prior : Array.from(knownAppIds).filter(Boolean);
      this.logger.info(`Incremental auth enabled: initial grant [${grant.join(', ')}]`);
    }

    this.state.set('authorizedAppIds', grant);
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
      // Progressive/Incremental authorization grant (computed in handleIncrementalAuth)
      authorizedAppIds,
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
      // Progressive/Incremental authorization: granted app-id set → minted as
      // the token's `authorized_apps` claim. Only set when incremental auth is
      // enabled (see handleIncrementalAuth); undefined otherwise (no claim).
      authorizedAppIds,
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
    'consent_submitted',
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
  /**
   * Defensively read a single param from a urlencoded POST body (some adapters
   * parse the body into `request.body`). The consent form uses a GET round-trip
   * (mirroring the federated page) so query params are the primary source; this
   * is a fallback for adapters that route a POST body instead. Multi-valued
   * keys keep all values so checkbox groups (`tools`) survive a POST.
   */
  private readBodyParam(request: { body?: unknown }, key: string): string | string[] | undefined {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const strings = value.filter((v): v is string => typeof v === 'string');
      return strings.length > 0 ? strings : undefined;
    }
    return undefined;
  }

  /**
   * Same-origin (CSRF) check for a state-changing login/consent submission.
   *
   * Returns true when the request carries an `Origin` or `Referer` header whose
   * host does NOT match the request's own host — the signature of a cross-site
   * login-CSRF/fixation. `Origin`/`Referer` are set by the browser and cannot
   * be forged by a malicious page, so this reliably distinguishes a legitimate
   * same-origin submission (the built-in form is served by THIS server) from a
   * cross-site one. Returns false (do NOT block) when neither header is present
   * or the request's own host cannot be determined — defense-in-depth, not a
   * hard gate, so header-stripped GET navigations and existing flows keep working.
   */
  private isCrossOriginSubmission(): boolean {
    const headers = (this.rawInput?.request?.headers ?? {}) as Record<string, string | string[] | undefined>;
    const first = (v: string | string[] | undefined): string | undefined =>
      Array.isArray(v) ? v[0] : typeof v === 'string' ? v : undefined;

    const source = first(headers['origin']) ?? first(headers['referer']);
    if (!source) return false; // no Origin/Referer to compare — don't block

    let sourceHost: string;
    try {
      sourceHost = new URL(source).host.toLowerCase();
    } catch {
      // A malformed Origin/Referer on a state-changing submission is suspicious.
      return true;
    }

    // Match against EITHER the direct Host or a proxy-forwarded host so the
    // check holds for direct exposure and behind a reverse proxy. The victim's
    // browser sets these on ITS OWN request, so an attacker cannot align them
    // with their cross-site Origin.
    const selfHosts = [first(headers['host']), first(headers['x-forwarded-host'])]
      .filter((h): h is string => !!h)
      .map((h) => h.toLowerCase());
    if (selfHosts.length === 0) return false; // can't determine self-origin — don't block

    return !selfHosts.includes(sourceHost);
  }

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
    const callbackPath = '/oauth/callback';
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
   * Render a custom `@AuthUi({ slot: 'consent' })` page when one is registered.
   *
   * Mints + persists the per-pending-auth CSRF token (reusing any token a prior
   * custom page already set on the record, so a consent re-render keeps the same
   * token), builds the consent {@link AuthFlowState} from the SAME tool
   * projection the built-in screen uses, SSRs the component, and responds with
   * the assembled page + CSP headers. Returns `true` when handled.
   */
  private async tryRenderCustomConsent(
    pendingAuth: { id: string; clientId: string; authUiCsrf?: string },
    consentConfig: ConsentConfig | undefined,
  ): Promise<boolean> {
    const authUi: AuthUiRegistry | undefined = this.scope.authUi;
    if (!authUi || !authUi.hasSlot('consent')) return false;

    // Reuse the record's existing token (set by the authorize-time login page or
    // a prior consent render) so the in-flight pending id keeps one stable CSRF.
    let csrfToken = pendingAuth.authUiCsrf;
    if (!csrfToken) {
      csrfToken = authUi.mintCsrf(pendingAuth.id);
      // The callback CSRF gate only fires when the pending record carries an
      // `authUiCsrf` (see the gate earlier in this flow). If we can't persist
      // the freshly-minted token, that gate would be SKIPPED on the consent
      // submit — a fail-OPEN path. So fail CLOSED here rather than render a
      // consent page whose submit can't be CSRF-verified.
      try {
        const localAuth = this.scope.auth as LocalPrimaryAuth;
        const record = await localAuth.authorizationStore.getPendingAuthorization(pendingAuth.id);
        if (!record) {
          this.respond(
            httpRespond.html(
              this.renderErrorPage('invalid_request', 'Authorization request has expired. Please try again.'),
              400,
            ),
          );
          return true;
        }
        record.authUiCsrf = csrfToken;
        await localAuth.authorizationStore.storePendingAuthorization(record);
      } catch (err) {
        this.logger.error(`Failed to persist auth-UI CSRF for consent: ${err instanceof Error ? err.message : err}`);
        this.respond(
          httpRespond.html(
            this.renderErrorPage('server_error', 'Failed to initialize consent securely. Please try again.'),
            500,
          ),
        );
        return true;
      }
    } else {
      // Keep the in-memory registry map in sync for the accumulator/verify path.
      authUi.mintCsrf(pendingAuth.id);
    }

    const { toolCards } = projectConsentTools(this.scope, consentConfig?.excludedTools);
    const tools: AuthTool[] = toolCards.map((c) => ({
      id: c.toolId,
      name: c.toolName,
      description: c.description,
      appId: c.appId,
      appName: c.appName,
      defaultSelected: consentConfig?.defaultSelectedTools?.includes(c.toolId),
    }));

    const state = buildConsentState(
      {
        pendingAuthId: pendingAuth.id,
        submitUrl: '/oauth/callback',
        extraUrl: authUiExtraPath(this.scope.fullPath),
        csrfToken,
        addedItems: authUi.getAddedItems(pendingAuth.id),
      },
      { clientId: pendingAuth.clientId, tools },
    );

    const page = buildAuthUiPage({ registry: authUi, slot: 'consent', state, fullPath: this.scope.fullPath });
    if (!page) return false;

    this.respond(httpRespond.html(page.html, 200, page.headers));
    return true;
  }

  /**
   * Render the tool-consent screen.
   *
   * The form GETs back to `/oauth/callback` carrying `pending_auth_id`,
   * `consent_submitted=1`, the resolved identity (`email`/`name` + any custom
   * `login.fields`), and the chosen `tools=` checkboxes — so the resubmit
   * re-derives the SAME subject and proceeds to mint.
   *
   * Honors the `auth.consent` flags: `groupByApp`, `showDescriptions`,
   * `customMessage`, `allowSelectAll`, `requireSelection`, `defaultSelectedTools`
   * (pre-checked), and `excludedTools` (filtered out of the offered set by
   * {@link projectConsentTools}). `error` re-renders the screen with a banner
   * (used for an empty `requireSelection` submit).
   */
  private renderConsentScreen(
    pendingAuth: { id: string; clientId: string; authUiCsrf?: string },
    consentConfig: ConsentConfig | undefined,
    identity: { email?: string; name?: string; loginFields?: Record<string, string> },
    error?: string,
    /**
     * When supplied (rememberConsent prefill on a new-tool re-prompt), these tool
     * ids are pre-checked INSTEAD of `consentConfig.defaultSelectedTools`, so the
     * user revisits their remembered selection and only has to decide about the
     * newly-added tool(s).
     */
    preSelectedTools?: string[],
  ): string {
    const callbackPath = '/oauth/callback';

    // Derive the offered tool cards from the scope via the shared projection so
    // the screen, the validation set, and call-time enforcement agree (and
    // `excludedTools` are removed here too).
    const { toolCards } = projectConsentTools(this.scope, consentConfig?.excludedTools);

    // Round-trip the identity (and any custom login fields) so the resubmit
    // re-derives the same subject. Reserved control params are never re-emitted
    // as login fields. Only string values are carried; nothing sensitive is
    // added by the framework — what the user submitted on the login form is
    // round-tripped, mirroring `renderLoginRetryPage`.
    const hiddenFields: ConsentHiddenField[] = [];
    if (identity.email) hiddenFields.push({ name: 'email', value: identity.email });
    if (identity.name) hiddenFields.push({ name: 'name', value: identity.name });
    for (const [key, value] of Object.entries(identity.loginFields ?? {})) {
      if (key === 'email' || key === 'name') continue; // already added above
      if (OauthCallbackFlow.RESERVED_LOGIN_PARAMS.has(key)) continue;
      hiddenFields.push({ name: key, value });
    }
    // When a custom `@AuthUi` login page set a CSRF token on the pending record
    // (#469), the built-in consent form must round-trip it so the consent submit
    // passes the CSRF gate. Built-in-only flows have no `authUiCsrf` → no field.
    if (pendingAuth.authUiCsrf) {
      hiddenFields.push({ name: 'csrf', value: pendingAuth.authUiCsrf });
    }

    return buildToolConsentPage({
      tools: toolCards,
      clientName: pendingAuth.clientId,
      pendingAuthId: pendingAuth.id,
      csrfToken: '',
      callbackPath,
      userName: identity.name,
      userEmail: identity.email,
      groupByApp: consentConfig?.groupByApp ?? true,
      showDescriptions: consentConfig?.showDescriptions ?? true,
      customMessage: consentConfig?.customMessage,
      allowSelectAll: consentConfig?.allowSelectAll ?? true,
      requireSelection: consentConfig?.requireSelection ?? true,
      // A remembered selection (rememberConsent re-prompt) overrides the static
      // `defaultSelectedTools` pre-check so the user revisits exactly what they
      // previously consented to.
      defaultSelectedTools: preSelectedTools ?? consentConfig?.defaultSelectedTools,
      error,
      hiddenFields,
    });
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

/** Constant-time string compare to avoid timing oracles on the CSRF token. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
