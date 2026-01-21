/**
 * OAuth Provider Callback Endpoint — GET /oauth/provider/:providerId/callback
 *
 * Who calls: Browser after user completes OAuth with an upstream provider
 *
 * When: During multi-provider (federated) authentication flow
 *
 * Purpose: Exchange upstream provider's authorization code for tokens,
 *          store tokens securely, then redirect to next provider or complete auth
 *
 * Flow:
 * 1. User selects providers on federated login page
 * 2. System redirects to first provider's /authorize
 * 3. User completes auth with provider
 * 4. Provider redirects here with authorization code
 * 5. We exchange code for tokens, store them
 * 6. If more providers in queue, redirect to next
 * 7. If all providers done, issue FrontMCP JWT
 */

import {
  Flow,
  FlowBase,
  FlowPlan,
  FlowRunOptions,
  httpInputSchema,
  HttpRedirectSchema,
  httpRespond,
  HttpHtmlSchema,
  StageHookOf,
  isOrchestratedMode,
} from '../../common';
import { z } from 'zod';
import { LocalPrimaryAuth } from '../instances/instance.local-primary-auth';
import { escapeHtml } from '../ui';
import {
  type FederatedAuthSession,
  type FederatedAuthSessionStore,
  type ProviderTokens,
  type ProviderUserInfo,
  completeCurrentProvider,
  startNextProvider,
  isSessionComplete,
  getNextProvider,
  type ProviderPkce,
} from '../session/federated-auth.session';
import { randomUUID, sha256Base64url, generateCodeVerifier } from '@frontmcp/utils';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  // From URL params
  providerId: z.string().optional(),
  // From query params
  code: z.string().optional(),
  error: z.string().optional(),
  errorDescription: z.string().optional(),
  providerState: z.string().optional(),
  // Federated session
  federatedSessionId: z.string().optional(),
  federatedSession: z.unknown().optional(), // FederatedAuthSession
  // Provider tokens
  providerTokens: z.unknown().optional(), // ProviderTokens
  providerUserInfo: z.unknown().optional(), // ProviderUserInfo
});

const outputSchema = z.union([HttpRedirectSchema, HttpHtmlSchema]);

const plan = {
  pre: ['parseInput', 'loadFederatedSession', 'validateProviderCallback'],
  execute: ['exchangeProviderCode', 'storeProviderTokens', 'handleNextProviderOrComplete'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'oauth:provider-callback': FlowRunOptions<
      OauthProviderCallbackFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'oauth:provider-callback' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'GET',
    path: '/oauth/provider/:providerId/callback',
  },
})
export default class OauthProviderCallbackFlow extends FlowBase<typeof name> {
  private logger = this.scope.logger.child('OauthProviderCallbackFlow');

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;

    // Extract provider ID from URL params
    const providerId = request.params?.['providerId'] as string | undefined;

    // Extract OAuth callback params from query
    const code = request.query['code'] as string | undefined;
    const error = request.query['error'] as string | undefined;
    const errorDescription = request.query['error_description'] as string | undefined;
    const providerState = request.query['state'] as string | undefined;

    this.state.set({
      providerId,
      code,
      error,
      errorDescription,
      providerState,
    });

    if (providerId) {
      this.logger.info(`Provider callback received for: ${providerId}`);
    }
  }

  @Stage('loadFederatedSession')
  async loadFederatedSession() {
    const { providerState } = this.state;

    if (!providerState) {
      this.logger.warn('Missing state parameter in provider callback');
      this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Missing state parameter'), 400));
      return;
    }

    // Extract federated session ID from state
    // State format: "federated:{sessionId}:{randomNonce}"
    const stateParts = providerState.split(':');
    if (stateParts.length < 3 || stateParts[0] !== 'federated') {
      this.logger.warn(`Invalid state format: ${providerState?.slice(0, 20)}...`);
      this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Invalid state parameter'), 400));
      return;
    }

    const federatedSessionId = stateParts[1];
    this.state.set('federatedSessionId', federatedSessionId);

    // Load federated session from store
    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const sessionStore = localAuth.federatedSessionStore;

    if (!sessionStore) {
      this.logger.error('Federated session store not configured');
      this.respond(
        httpRespond.html(this.renderErrorPage('server_error', 'Federated authentication not configured'), 500),
      );
      return;
    }

    const session = await sessionStore.get(federatedSessionId);

    if (!session) {
      this.logger.warn(`Federated session not found or expired: ${federatedSessionId}`);
      this.respond(
        httpRespond.html(
          this.renderErrorPage('invalid_request', 'Authentication session expired. Please try again.'),
          400,
        ),
      );
      return;
    }

    const stateValidation = this.getStateValidation();
    if (stateValidation === 'strict') {
      const expectedState = session.currentProviderState;
      if (!expectedState || expectedState !== providerState) {
        this.logger.warn(`State mismatch for provider callback: expected ${expectedState}, got ${providerState}`);
        this.respond(
          httpRespond.html(
            this.renderErrorPage('invalid_request', 'Invalid state parameter. Please restart authentication.'),
            400,
          ),
        );
        return;
      }
    }

    this.state.set('federatedSession', session);
  }

  @Stage('validateProviderCallback')
  async validateProviderCallback() {
    const { providerId, code, error, errorDescription, federatedSession } = this.state;
    const session = federatedSession as FederatedAuthSession | undefined;

    if (!session) {
      return; // Already handled in loadFederatedSession
    }

    // Check for OAuth error from provider
    if (error) {
      this.logger.warn(`Provider ${providerId} returned error: ${error} - ${errorDescription}`);

      // For certain errors, allow user to skip this provider
      if (error === 'access_denied') {
        // User declined - skip this provider and continue
        this.logger.info(`User declined authorization for provider: ${providerId}`);
        // Fall through to complete current provider as skipped
      } else {
        this.respond(
          httpRespond.html(
            this.renderErrorPage('provider_error', `Authentication provider error: ${errorDescription || error}`),
            400,
          ),
        );
        return;
      }
    }

    // Verify provider ID matches current provider in session
    if (session.currentProviderId !== providerId) {
      this.logger.warn(`Provider ID mismatch: expected ${session.currentProviderId}, got ${providerId}`);
      this.respond(
        httpRespond.html(
          this.renderErrorPage('invalid_request', 'Provider ID mismatch. Please restart authentication.'),
          400,
        ),
      );
      return;
    }

    // Verify we have a code (unless error was access_denied)
    if (!code && error !== 'access_denied') {
      this.logger.warn('Missing authorization code in provider callback');
      this.respond(
        httpRespond.html(this.renderErrorPage('invalid_request', 'Missing authorization code from provider'), 400),
      );
      return;
    }
  }

  @Stage('exchangeProviderCode')
  async exchangeProviderCode() {
    const { providerId, code, error, federatedSession } = this.state;
    const session = federatedSession as FederatedAuthSession | undefined;

    if (!session || !providerId) {
      return;
    }

    // Skip token exchange if user declined (access_denied)
    if (error === 'access_denied') {
      this.logger.info(`Skipping token exchange for declined provider: ${providerId}`);
      // Mark as completed with no tokens
      this.state.set('providerTokens', null);
      return;
    }

    if (!code) {
      return;
    }

    const localAuth = this.scope.auth as LocalPrimaryAuth;

    try {
      // Exchange authorization code for tokens with upstream provider
      const result = await localAuth.exchangeProviderCode(providerId, code, session.currentProviderPkce?.verifier);

      if ('error' in result) {
        this.logger.error(`Provider token exchange failed: ${result.error} - ${result.error_description}`);
        this.respond(
          httpRespond.html(
            this.renderErrorPage(
              'provider_error',
              `Failed to exchange code with provider: ${result.error_description}`,
            ),
            400,
          ),
        );
        return;
      }

      const tokens: ProviderTokens = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined,
        tokenType: result.token_type,
        scopes: result.scope?.split(' '),
        idToken: result.id_token,
      };

      this.state.set('providerTokens', tokens);

      // Try to get user info from provider
      if (result.id_token || result.access_token) {
        try {
          const userInfo = await localAuth.getProviderUserInfo(providerId, result.access_token, result.id_token);
          this.state.set('providerUserInfo', userInfo);
        } catch (err) {
          this.logger.warn(`Failed to get user info from provider ${providerId}: ${err}`);
          // Continue without user info
        }
      }

      this.logger.info(`Successfully exchanged code for tokens with provider: ${providerId}`);
    } catch (err) {
      this.logger.error(`Provider token exchange error: ${err}`);
      this.respond(
        httpRespond.html(this.renderErrorPage('server_error', 'Failed to complete authentication with provider'), 500),
      );
    }
  }

  @Stage('storeProviderTokens')
  async storeProviderTokens() {
    const { providerId, federatedSession, providerTokens, providerUserInfo } = this.state;
    const session = federatedSession as FederatedAuthSession | undefined;
    const tokens = providerTokens as ProviderTokens | null | undefined;
    const userInfo = providerUserInfo as ProviderUserInfo | undefined;

    if (!session || !providerId) {
      return;
    }

    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const tokenStore = localAuth.orchestratedTokenStore;

    // Store tokens if we have them (user didn't decline)
    if (tokens && tokenStore) {
      // Use pendingAuthId as authorization ID for now (will be replaced with real auth ID after JWT issuance)
      const tempAuthId = `pending:${session.pendingAuthId}`;

      await tokenStore.storeTokens(tempAuthId, providerId, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });

      this.logger.info(`Stored tokens for provider ${providerId} (temp auth: ${tempAuthId})`);
    }

    // Complete the current provider in the session
    if (tokens) {
      completeCurrentProvider(session, tokens, userInfo);
    } else {
      // Provider was skipped/declined - mark as completed without tokens
      // Remove from completed providers (it was declined)
      session.currentProviderId = undefined;
      session.currentProviderPkce = undefined;
      session.currentProviderState = undefined;
    }

    // Update session in store
    const sessionStore = localAuth.federatedSessionStore;
    if (sessionStore) {
      await sessionStore.update(session);
    }

    this.state.set('federatedSession', session);
  }

  @Stage('handleNextProviderOrComplete')
  async handleNextProviderOrComplete() {
    const { federatedSession } = this.state;
    const session = federatedSession as FederatedAuthSession | undefined;

    if (!session) {
      return;
    }

    const localAuth = this.scope.auth as LocalPrimaryAuth;

    // Check if all providers are done
    if (isSessionComplete(session)) {
      this.logger.info('All providers authenticated, completing federated auth flow');
      return this.completeFederatedAuth(session);
    }

    // Get next provider
    const nextProviderId = getNextProvider(session);
    if (!nextProviderId) {
      // No more providers, complete the flow
      return this.completeFederatedAuth(session);
    }

    // Generate PKCE for next provider
    const verifier = generateCodeVerifier();
    const challenge = sha256Base64url(verifier);
    const pkce: ProviderPkce = {
      verifier,
      challenge,
      method: 'S256',
    };

    // Generate state for next provider
    const providerState = `federated:${session.id}:${randomUUID()}`;

    // Start next provider
    startNextProvider(session, pkce, providerState);

    // Update session
    const sessionStore = localAuth.federatedSessionStore;
    if (sessionStore) {
      await sessionStore.update(session);
    }

    // Build redirect URL for next provider
    const redirectUrl = await localAuth.buildProviderAuthorizeUrl(nextProviderId, {
      state: providerState,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
    });

    if (!redirectUrl) {
      this.logger.error(`Failed to build authorize URL for provider: ${nextProviderId}`);
      this.respond(
        httpRespond.html(
          this.renderErrorPage('server_error', `Failed to initiate auth with provider: ${nextProviderId}`),
          500,
        ),
      );
      return;
    }

    this.logger.info(`Redirecting to next provider: ${nextProviderId}`);
    this.respond(httpRespond.redirect(redirectUrl));
  }

  /**
   * Complete the federated auth flow and issue FrontMCP JWT
   */
  private async completeFederatedAuth(session: FederatedAuthSession): Promise<void> {
    const localAuth = this.scope.auth as LocalPrimaryAuth;

    // Build selected provider IDs from completed providers
    const selectedProviderIds = Array.from(session.completedProviders.keys());
    const skippedProviderIds: string[] = []; // TODO: Track skipped providers properly

    // Create authorization code with consent/federated data
    // Include pendingAuthId for token migration in token exchange flow
    const code = await localAuth.createAuthorizationCode({
      clientId: session.clientId,
      redirectUri: session.redirectUri,
      scopes: session.scopes,
      codeChallenge: session.frontmcpPkce.challenge,
      userSub: session.userInfo.sub || this.generateUserSub(session.userInfo.email),
      userEmail: session.userInfo.email,
      userName: session.userInfo.name,
      state: session.state,
      resource: session.resource,
      // Federated login data
      selectedProviderIds,
      skippedProviderIds,
      federatedLoginUsed: true,
      // Token migration: pendingAuthId links to tokens stored during provider callbacks
      pendingAuthId: session.pendingAuthId,
    });

    // Delete the federated session (no longer needed)
    const sessionStore = localAuth.federatedSessionStore;
    if (sessionStore) {
      await sessionStore.delete(session.id);
    }

    // Build redirect URL with authorization code
    const url = new URL(session.redirectUri);
    url.searchParams.set('code', code);
    if (session.state) {
      url.searchParams.set('state', session.state);
    }

    this.logger.info(
      `Federated auth complete: ${selectedProviderIds.length} providers authenticated, redirecting to client`,
    );
    this.respond(httpRespond.redirect(url.toString()));
  }

  /**
   * Generate a deterministic user sub from email
   */
  private generateUserSub(email?: string): string {
    if (!email) {
      return `anon:${randomUUID()}`;
    }
    const hash = sha256Base64url(email.toLowerCase());
    return `user:${hash.substring(0, 16)}`;
  }

  /**
   * Render an error page
   */
  private renderErrorPage(error: string, description: string): string {
    const safeError = escapeHtml(error);
    const safeDescription = escapeHtml(description);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Provider Authentication Error</title>
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
    <h1>Authentication Error</h1>
    <p><span class="error-code">${safeError}</span></p>
    <p>${safeDescription}</p>
    <a href="javascript:history.back()" class="retry-link">← Go Back</a>
  </div>
</body>
</html>`;
  }

  private getStateValidation(): 'strict' | 'format' {
    const authOptions = this.scope.auth?.options;
    if (authOptions && isOrchestratedMode(authOptions)) {
      return authOptions.federatedAuth?.stateValidation ?? 'strict';
    }
    return 'strict';
  }
}
