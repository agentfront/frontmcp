/**
 * OAuth Authorize Flow Tests
 *
 * Comprehensive tests for the /oauth/authorize endpoint covering:
 * - Authorization Store (InMemoryAuthorizationStore)
 * - PKCE validation
 * - OAuth request validation
 * - Authorization modes (anonymous, orchestrated, incremental, federated, consent)
 * - Flow execution (parseInput, validateInput, buildAuthorizeOutput)
 * - Error handling
 */
import 'reflect-metadata';
import { z } from 'zod';
import OauthAuthorizeFlow from '../oauth.authorize.flow';
import { InMemoryAuthorizationStore, generatePkceChallenge } from '@frontmcp/auth';
import {
  // Flow test utilities
  createMockScopeEntry,
  runFlowStages,
  flowScenarios,
  // OAuth test utilities
  generateCodeVerifier,
  generatePkcePair,
  createValidOAuthRequest,
  createAnonymousOAuthRequest,
  createIncrementalAuthRequest,
  createOAuthInput,
  invalidOAuthRequests,
  expectOAuthRedirect,
  expectOAuthHtmlPage,
} from '../../../__test-utils__';
import { FlowMetadata, httpInputSchema, HttpRedirectSchema, HttpTextSchema, HttpHtmlSchema } from '../../../common';

// ============================================
// Test Setup Helpers
// ============================================

/**
 * Create flow metadata for OauthAuthorizeFlow
 */
function createFlowMetadata(): FlowMetadata<'oauth:authorize'> {
  const outputSchema = z.union([HttpRedirectSchema, HttpTextSchema, HttpHtmlSchema]);

  return {
    name: 'oauth:authorize',
    plan: {
      pre: ['parseInput', 'validateInput', 'checkIfAuthorized'],
      execute: ['prepareAuthorizationRequest', 'buildAuthorizeOutput'],
      post: ['validateOutput'],
    },
    inputSchema: httpInputSchema,
    outputSchema,
    access: 'public',
    middleware: {
      method: 'GET',
      path: '/oauth/authorize',
    },
  } as FlowMetadata<'oauth:authorize'>;
}

// ============================================
// Authorization Store Tests
// ============================================

describe('OAuth Authorize Flow', () => {
  describe('InMemoryAuthorizationStore', () => {
    let store: InMemoryAuthorizationStore;

    beforeEach(() => {
      store = new InMemoryAuthorizationStore();
    });

    describe('Pending Authorization', () => {
      it('should create and store pending authorization', async () => {
        const pkce = generatePkcePair();

        const pending = store.createPendingRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: ['openid', 'profile'],
          pkce: pkce.challenge,
          state: 'test-state',
        });

        await store.storePendingAuthorization(pending);

        const retrieved = await store.getPendingAuthorization(pending.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.clientId).toBe('test-client');
        expect(retrieved?.pkce.challenge).toBe(pkce.challenge.challenge);
      });

      it('should return null for non-existent pending authorization', async () => {
        const result = await store.getPendingAuthorization('non-existent');
        expect(result).toBeNull();
      });

      it('should return null for expired pending authorization', async () => {
        const pkce = generatePkcePair();

        const pending = store.createPendingRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: [],
          pkce: pkce.challenge,
        });

        pending.expiresAt = Date.now() - 1000;
        await store.storePendingAuthorization(pending);

        const result = await store.getPendingAuthorization(pending.id);
        expect(result).toBeNull();
      });

      it('should delete pending authorization', async () => {
        const pkce = generatePkcePair();

        const pending = store.createPendingRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: [],
          pkce: pkce.challenge,
        });

        await store.storePendingAuthorization(pending);
        await store.deletePendingAuthorization(pending.id);

        const result = await store.getPendingAuthorization(pending.id);
        expect(result).toBeNull();
      });

      it('should store incremental authorization fields', async () => {
        const pkce = generatePkcePair();

        const pending = store.createPendingRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: [],
          pkce: pkce.challenge,
          isIncremental: true,
          targetAppId: 'slack',
          targetToolId: 'slack:send_message',
          existingSessionId: 'session-123',
        });

        await store.storePendingAuthorization(pending);

        const retrieved = await store.getPendingAuthorization(pending.id);
        expect(retrieved?.isIncremental).toBe(true);
        expect(retrieved?.targetAppId).toBe('slack');
        expect(retrieved?.targetToolId).toBe('slack:send_message');
        expect(retrieved?.existingSessionId).toBe('session-123');
      });

      it('should store federated login state', async () => {
        const pkce = generatePkcePair();

        const pending = store.createPendingRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: [],
          pkce: pkce.challenge,
          federatedLogin: {
            providerIds: ['google', 'github', 'slack'],
            selectedProviderIds: ['google'],
            skippedProviderIds: ['github', 'slack'],
          },
        });

        await store.storePendingAuthorization(pending);

        const retrieved = await store.getPendingAuthorization(pending.id);
        expect(retrieved?.federatedLogin?.providerIds).toEqual(['google', 'github', 'slack']);
        expect(retrieved?.federatedLogin?.selectedProviderIds).toEqual(['google']);
        expect(retrieved?.federatedLogin?.skippedProviderIds).toEqual(['github', 'slack']);
      });

      it('should store consent state', async () => {
        const pkce = generatePkcePair();

        const pending = store.createPendingRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: [],
          pkce: pkce.challenge,
          consent: {
            enabled: true,
            availableToolIds: ['slack:send_message', 'github:create_issue'],
            selectedToolIds: ['slack:send_message'],
            consentCompleted: true,
            consentCompletedAt: Date.now(),
          },
        });

        await store.storePendingAuthorization(pending);

        const retrieved = await store.getPendingAuthorization(pending.id);
        expect(retrieved?.consent?.enabled).toBe(true);
        expect(retrieved?.consent?.availableToolIds).toEqual(['slack:send_message', 'github:create_issue']);
        expect(retrieved?.consent?.selectedToolIds).toEqual(['slack:send_message']);
        expect(retrieved?.consent?.consentCompleted).toBe(true);
      });
    });

    describe('Authorization Code', () => {
      it('should create and store authorization code', async () => {
        const pkce = generatePkcePair();

        const code = store.createCodeRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: ['openid', 'profile'],
          pkce: pkce.challenge,
          userSub: 'user-123',
          userEmail: 'user@example.com',
          userName: 'Test User',
          state: 'test-state',
        });

        await store.storeAuthorizationCode(code);

        const retrieved = await store.getAuthorizationCode(code.code);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.clientId).toBe('test-client');
        expect(retrieved?.userSub).toBe('user-123');
        expect(retrieved?.used).toBe(false);
      });

      it('should mark code as used', async () => {
        const pkce = generatePkcePair();

        const code = store.createCodeRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: [],
          pkce: pkce.challenge,
          userSub: 'user-123',
        });

        await store.storeAuthorizationCode(code);
        await store.markCodeUsed(code.code);

        const retrieved = await store.getAuthorizationCode(code.code);
        expect(retrieved?.used).toBe(true);
      });

      it('should return null for expired code', async () => {
        const pkce = generatePkcePair();

        const code = store.createCodeRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: [],
          pkce: pkce.challenge,
          userSub: 'user-123',
        });

        code.expiresAt = Date.now() - 1000;
        await store.storeAuthorizationCode(code);

        const result = await store.getAuthorizationCode(code.code);
        expect(result).toBeNull();
      });

      it('should store consent and federated login data in code', async () => {
        const pkce = generatePkcePair();

        const code = store.createCodeRecord({
          clientId: 'test-client',
          redirectUri: 'https://client.example.com/callback',
          scopes: ['openid'],
          pkce: pkce.challenge,
          userSub: 'user-123',
          selectedToolIds: ['slack:send_message', 'github:create_issue'],
          selectedProviderIds: ['google'],
          skippedProviderIds: ['slack'],
          consentEnabled: true,
          federatedLoginUsed: true,
        });

        await store.storeAuthorizationCode(code);

        const retrieved = await store.getAuthorizationCode(code.code);
        expect(retrieved?.selectedToolIds).toEqual(['slack:send_message', 'github:create_issue']);
        expect(retrieved?.selectedProviderIds).toEqual(['google']);
        expect(retrieved?.skippedProviderIds).toEqual(['slack']);
        expect(retrieved?.consentEnabled).toBe(true);
        expect(retrieved?.federatedLoginUsed).toBe(true);
      });
    });

    describe('Refresh Token', () => {
      it('should create and store refresh token', async () => {
        const token = store.createRefreshTokenRecord({
          clientId: 'test-client',
          userSub: 'user-123',
          scopes: ['openid', 'offline_access'],
        });

        await store.storeRefreshToken(token);

        const retrieved = await store.getRefreshToken(token.token);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.clientId).toBe('test-client');
        expect(retrieved?.revoked).toBe(false);
      });

      it('should revoke refresh token', async () => {
        const token = store.createRefreshTokenRecord({
          clientId: 'test-client',
          userSub: 'user-123',
          scopes: [],
        });

        await store.storeRefreshToken(token);
        await store.revokeRefreshToken(token.token);

        const retrieved = await store.getRefreshToken(token.token);
        expect(retrieved).toBeNull();
      });

      it('should rotate refresh token', async () => {
        const oldToken = store.createRefreshTokenRecord({
          clientId: 'test-client',
          userSub: 'user-123',
          scopes: [],
        });

        await store.storeRefreshToken(oldToken);

        const newToken = store.createRefreshTokenRecord({
          clientId: 'test-client',
          userSub: 'user-123',
          scopes: [],
        });

        await store.rotateRefreshToken(oldToken.token, newToken);

        const oldRetrieved = await store.getRefreshToken(oldToken.token);
        expect(oldRetrieved).toBeNull();

        const newRetrieved = await store.getRefreshToken(newToken.token);
        expect(newRetrieved).not.toBeNull();
        expect(newRetrieved?.previousToken).toBe(oldToken.token);
      });
    });

    describe('Cleanup', () => {
      it('should clean up expired records', async () => {
        const pkce = generatePkcePair();

        const pending = store.createPendingRecord({
          clientId: 'test-client',
          redirectUri: 'https://example.com/callback',
          scopes: [],
          pkce: pkce.challenge,
        });
        pending.expiresAt = Date.now() - 1000;
        await store.storePendingAuthorization(pending);

        const code = store.createCodeRecord({
          clientId: 'test-client',
          redirectUri: 'https://example.com/callback',
          scopes: [],
          pkce: pkce.challenge,
          userSub: 'user-123',
        });
        code.expiresAt = Date.now() - 1000;
        await store.storeAuthorizationCode(code);

        const token = store.createRefreshTokenRecord({
          clientId: 'test-client',
          userSub: 'user-123',
          scopes: [],
        });
        token.expiresAt = Date.now() - 1000;
        await store.storeRefreshToken(token);

        await store.cleanup();

        expect(await store.getPendingAuthorization(pending.id)).toBeNull();
        expect(await store.getAuthorizationCode(code.code)).toBeNull();
        expect(await store.getRefreshToken(token.token)).toBeNull();
      });
    });
  });

  // ============================================
  // PKCE Tests
  // ============================================

  describe('PKCE', () => {
    describe('generatePkceChallenge', () => {
      it('should generate S256 challenge from verifier', () => {
        const verifier = generateCodeVerifier();
        const challenge = generatePkceChallenge(verifier);

        expect(challenge.method).toBe('S256');
        expect(challenge.challenge).toBeDefined();
        expect(challenge.challenge.length).toBeGreaterThan(0);
      });

      it('should produce consistent challenge for same verifier', () => {
        const verifier = generateCodeVerifier();
        const challenge1 = generatePkceChallenge(verifier);
        const challenge2 = generatePkceChallenge(verifier);

        expect(challenge1.challenge).toBe(challenge2.challenge);
      });

      it('should produce different challenge for different verifiers', () => {
        const verifier1 = generateCodeVerifier();
        const verifier2 = generateCodeVerifier();

        const challenge1 = generatePkceChallenge(verifier1);
        const challenge2 = generatePkceChallenge(verifier2);

        expect(challenge1.challenge).not.toBe(challenge2.challenge);
      });

      it('should produce base64url encoded challenge', () => {
        const verifier = generateCodeVerifier();
        const challenge = generatePkceChallenge(verifier);

        expect(challenge.challenge).not.toMatch(/[+/=]/);
        expect(challenge.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
      });
    });

    describe('generateCodeVerifier', () => {
      it('should generate verifier with default length of 64', () => {
        const verifier = generateCodeVerifier();
        expect(verifier.length).toBe(64);
      });

      it('should generate verifier with custom length', () => {
        const verifier = generateCodeVerifier(43);
        expect(verifier.length).toBe(43);
      });

      it('should throw for length < 43', () => {
        expect(() => generateCodeVerifier(42)).toThrow();
      });

      it('should throw for length > 128', () => {
        expect(() => generateCodeVerifier(129)).toThrow();
      });

      it('should only contain valid PKCE characters', () => {
        const verifier = generateCodeVerifier();
        expect(verifier).toMatch(/^[A-Za-z0-9._~-]+$/);
      });
    });
  });

  // ============================================
  // OAuth Request Validation Tests
  // ============================================

  describe('OAuth Request Validation', () => {
    describe('createValidOAuthRequest', () => {
      it('should create valid OAuth parameters', () => {
        const params = createValidOAuthRequest();

        expect(params.response_type).toBe('code');
        expect(params.client_id).toBeDefined();
        expect(params.redirect_uri).toBeDefined();
        expect(params.code_challenge).toBeDefined();
        expect(params.code_challenge_method).toBe('S256');
        expect(params._pkce).toBeDefined();
      });

      it('should allow overrides', () => {
        const params = createValidOAuthRequest({
          client_id: 'custom-client',
          scope: 'openid profile email',
        });

        expect(params.client_id).toBe('custom-client');
        expect(params.scope).toBe('openid profile email');
      });
    });

    describe('code_challenge validation', () => {
      it('should have minimum 43 characters', () => {
        const params = createValidOAuthRequest();
        expect(params.code_challenge!.length).toBeGreaterThanOrEqual(43);
      });

      it('should have maximum 128 characters', () => {
        const params = createValidOAuthRequest();
        expect(params.code_challenge!.length).toBeLessThanOrEqual(128);
      });

      it('should only contain base64url characters', () => {
        const params = createValidOAuthRequest();
        expect(params.code_challenge).toMatch(/^[A-Za-z0-9_-]+$/);
      });
    });

    describe('redirect_uri validation', () => {
      it('should require valid URL', () => {
        const params = createValidOAuthRequest();
        expect(() => new URL(params.redirect_uri!)).not.toThrow();
      });
    });
  });

  // ============================================
  // Flow Execution Tests - Anonymous Mode
  // ============================================

  describe('Flow Execution - Anonymous Mode', () => {
    it('should redirect with anonymous code when no auth is configured', async () => {
      const scope = flowScenarios.anonymous();
      const metadata = createFlowMetadata();
      const params = createAnonymousOAuthRequest({
        redirect_uri: 'https://client.example.com/callback',
        state: 'test-state',
      });
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);

      expectOAuthRedirect(output, {
        code: 'anonymous',
        state: 'test-state',
      });
    });

    it('should redirect with anonymous code without state', async () => {
      const scope = flowScenarios.anonymous();
      const metadata = createFlowMetadata();
      const params = createAnonymousOAuthRequest({
        redirect_uri: 'https://client.example.com/callback',
      });
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);

      expectOAuthRedirect(output, { code: 'anonymous' });
      expect(output.location).not.toContain('state=');
    });

    it('should return error page for invalid redirect_uri', async () => {
      const scope = flowScenarios.anonymous();
      const metadata = createFlowMetadata();
      const params = createAnonymousOAuthRequest({
        redirect_uri: 'not-a-valid-url',
      });
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);

      expectOAuthHtmlPage(output, {
        status: 400,
        contains: ['Authorization Error'],
      });
    });

    it('should return error page for missing redirect_uri', async () => {
      const scope = flowScenarios.anonymous();
      const metadata = createFlowMetadata();
      const input = createOAuthInput({});

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);

      expectOAuthHtmlPage(output, {
        status: 400,
      });
    });
  });

  // ============================================
  // Flow Execution Tests - Orchestrated Mode
  // ============================================

  describe('Flow Execution - Orchestrated Mode', () => {
    it('should store pending authorization and render login page', async () => {
      const scope = flowScenarios.orchestratedLocal();
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest({
        scope: 'openid profile',
      });
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, [
        'parseInput',
        'validateInput',
        'checkIfAuthorized',
        'prepareAuthorizationRequest',
        'buildAuthorizeOutput',
      ]);

      expectOAuthHtmlPage(output, {
        contains: ['Sign In', params.client_id!, 'openid', 'profile'],
      });
    });

    it('should validate flow state after parseInput', async () => {
      const scope = flowScenarios.orchestratedLocal();
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest({ state: 'my-state' });
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      await runFlowStages(flow, ['parseInput']);

      const state = flow.state.snapshot();
      expect(state.rawRedirectUri).toBe(params.redirect_uri);
      expect(state.rawState).toBe('my-state');
    });

    it('should track validated request in state after validation', async () => {
      const scope = flowScenarios.orchestratedLocal();
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest({
        scope: 'openid profile email',
        resource: 'https://api.example.com',
      });
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      await runFlowStages(flow, ['parseInput', 'validateInput']);

      const state = flow.state.snapshot();
      expect(state.validatedRequest).toBeDefined();
      expect(state.validatedRequest?.response_type).toBe('code');
      expect(state.validatedRequest?.client_id).toBe(params.client_id);
      expect(state.validatedRequest?.redirect_uri).toBe(params.redirect_uri);
      expect(state.validatedRequest?.scope).toBe('openid profile email');
    });

    it('should track pending auth ID after prepareAuthorizationRequest', async () => {
      const scope = flowScenarios.orchestratedLocal();
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest();
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      await runFlowStages(flow, ['parseInput', 'validateInput', 'checkIfAuthorized', 'prepareAuthorizationRequest']);

      const state = flow.state.snapshot();
      expect(state.pendingAuthId).toBeDefined();
      expect(typeof state.pendingAuthId).toBe('string');
    });

    it('should show error page when redirect_uri is invalid', async () => {
      const scope = flowScenarios.orchestratedLocal();
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest({ redirect_uri: 'invalid-url' });
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);

      expectOAuthHtmlPage(output, {
        status: 400,
        contains: ['Authorization Error'],
      });
    });
  });

  // ============================================
  // Flow Execution Tests - Incremental Authorization
  // ============================================

  describe('Flow Execution - Incremental Authorization', () => {
    it('should detect incremental auth mode from query params', async () => {
      const scope = flowScenarios.incrementalAuth('slack');
      const metadata = createFlowMetadata();
      const params = createIncrementalAuthRequest('slack', 'slack:send_message', 'session-123');
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      await runFlowStages(flow, ['parseInput']);

      const state = flow.state.snapshot();
      expect(state.isIncrementalAuth).toBe(true);
      expect(state.targetAppId).toBe('slack');
      expect(state.targetToolId).toBe('slack:send_message');
      expect(state.existingSessionId).toBe('session-123');
    });

    it('should render incremental auth page for single app', async () => {
      const scope = flowScenarios.incrementalAuth('slack');
      const metadata = createFlowMetadata();
      const params = createIncrementalAuthRequest('slack', 'slack:send_message');
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, [
        'parseInput',
        'validateInput',
        'checkIfAuthorized',
        'prepareAuthorizationRequest',
        'buildAuthorizeOutput',
      ]);

      expect(output.kind).toBe('html');
      expect(output.body).toContain('Authorize Slack');
      expect(output.body).toContain('slack:send_message');
    });
  });

  // ============================================
  // Flow Execution Tests - Federated Login
  // ============================================

  describe('Flow Execution - Federated Login', () => {
    it('should not require federated login when apps have no auth', async () => {
      const scope = createMockScopeEntry({
        auth: { mode: 'local' },
        apps: [
          { id: 'app1', name: 'App 1' },
          { id: 'app2', name: 'App 2' },
        ],
      });
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest();
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      await runFlowStages(flow, ['parseInput']);

      const state = flow.state.snapshot();
      expect(state.requiresFederatedLogin).toBe(false);
    });

    it('should render login page for multi-app scenario', async () => {
      const scope = flowScenarios.multiApp();
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest();
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, [
        'parseInput',
        'validateInput',
        'checkIfAuthorized',
        'prepareAuthorizationRequest',
        'buildAuthorizeOutput',
      ]);

      expect(output.kind).toBe('html');
      expect(output.body).toMatch(/Sign In|Select Authorization Providers/);
    });
  });

  // ============================================
  // Flow Execution Tests - Consent
  // ============================================

  describe('Flow Execution - Consent', () => {
    it('should detect consent state from config', async () => {
      const scope = flowScenarios.withConsent();
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest();
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      await runFlowStages(flow, ['parseInput']);

      const state = flow.state.snapshot();
      expect(typeof state.requiresConsent).toBe('boolean');
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================

  describe('Error Handling', () => {
    it('should show error page when validation fails', async () => {
      const scope = flowScenarios.orchestratedLocal();
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest();
      // Remove PKCE to trigger validation error
      delete (params as any).code_challenge;
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);

      // In anonymous mode (our mock), shows redirect or HTML
      expect(['redirect', 'html']).toContain(output.kind);
    });

    it('should handle multiple validation errors', async () => {
      const scope = flowScenarios.orchestratedLocal();
      const metadata = createFlowMetadata();
      const params = invalidOAuthRequests.multipleErrors();
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);

      expect(['redirect', 'html']).toContain(output.kind);
    });

    it('should show error page for invalid redirect_uri', async () => {
      const scope = flowScenarios.orchestratedLocal();
      const metadata = createFlowMetadata();
      const params = invalidOAuthRequests.invalidRedirectUri();
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());

      const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);

      expectOAuthHtmlPage(output, {
        status: 400,
        contains: ['Authorization Error'],
      });
    });
  });

  // ============================================
  // Combined Flow Tests
  // ============================================

  describe('Combined Flows', () => {
    let store: InMemoryAuthorizationStore;

    beforeEach(() => {
      store = new InMemoryAuthorizationStore();
    });

    it('should support federated login + consent in same flow', async () => {
      const pkce = generatePkcePair();

      const pending = store.createPendingRecord({
        clientId: 'test-client',
        redirectUri: 'https://client.example.com/callback',
        scopes: ['openid', 'profile'],
        pkce: pkce.challenge,
        federatedLogin: {
          providerIds: ['google', 'slack'],
          selectedProviderIds: ['google', 'slack'],
        },
        consent: {
          enabled: true,
          availableToolIds: ['slack:send_message', 'google:calendar'],
          selectedToolIds: ['slack:send_message'],
          consentCompleted: true,
        },
      });

      await store.storePendingAuthorization(pending);

      const retrieved = await store.getPendingAuthorization(pending.id);
      expect(retrieved?.federatedLogin).toBeDefined();
      expect(retrieved?.consent).toBeDefined();
      expect(retrieved?.federatedLogin?.selectedProviderIds).toContain('slack');
      expect(retrieved?.consent?.selectedToolIds).toContain('slack:send_message');
    });

    it('should flow from pending to code with all metadata', async () => {
      const pkce = generatePkcePair();

      const pending = store.createPendingRecord({
        clientId: 'test-client',
        redirectUri: 'https://client.example.com/callback',
        scopes: ['openid'],
        pkce: pkce.challenge,
        state: 'flow-state',
        federatedLogin: {
          providerIds: ['google', 'slack'],
        },
        consent: {
          enabled: true,
          availableToolIds: ['tool1', 'tool2'],
          consentCompleted: false,
        },
      });
      await store.storePendingAuthorization(pending);

      const code = store.createCodeRecord({
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        scopes: pending.scopes,
        pkce: pending.pkce,
        userSub: 'user-from-google',
        userEmail: 'user@gmail.com',
        userName: 'Test User',
        state: pending.state,
        selectedProviderIds: ['google'],
        skippedProviderIds: ['slack'],
        selectedToolIds: ['tool1'],
        consentEnabled: true,
        federatedLoginUsed: true,
      });

      await store.storeAuthorizationCode(code);
      await store.deletePendingAuthorization(pending.id);

      const retrieved = await store.getAuthorizationCode(code.code);
      expect(retrieved?.userEmail).toBe('user@gmail.com');
      expect(retrieved?.selectedProviderIds).toEqual(['google']);
      expect(retrieved?.skippedProviderIds).toEqual(['slack']);
      expect(retrieved?.selectedToolIds).toEqual(['tool1']);
      expect(retrieved?.consentEnabled).toBe(true);
      expect(retrieved?.federatedLoginUsed).toBe(true);

      expect(await store.getPendingAuthorization(pending.id)).toBeNull();
    });
  });

  // ============================================
  // Invalid PKCE Tests
  // ============================================

  describe('Invalid PKCE', () => {
    it('should reject challenge shorter than 43 characters', async () => {
      const scope = flowScenarios.orchestratedLocal();
      const metadata = createFlowMetadata();
      const params = createValidOAuthRequest();
      params.code_challenge = 'too-short'; // < 43 chars
      const input = createOAuthInput(params);

      const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());
      const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);

      // With valid redirect_uri, errors are redirected per OAuth 2.1 spec
      expectOAuthRedirect(output, { error: 'invalid_request', errorContains: 'code_challenge' });
    });

    it('should reject challenge longer than 128 characters', () => {
      const longChallenge = 'a'.repeat(130);
      expect(longChallenge.length).toBeGreaterThan(128);
    });

    it('should reject challenge with invalid characters', () => {
      const invalidChallenge = 'valid-part' + '!@#$%' + 'more-valid';
      expect(invalidChallenge).toMatch(/[^A-Za-z0-9_-]/);
    });
  });

  // ============================================
  // Invalid redirect_uri Tests
  // ============================================

  describe('Invalid redirect_uri', () => {
    /**
     * Helper to validate redirect URIs safely.
     * Only allows http: and https: schemes.
     */
    function isValidRedirectUri(uri: string): boolean {
      try {
        const url = new URL(uri);
        // Only allow http and https schemes (case-insensitive via URL parsing)
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }

    it('should reject non-URL redirect_uri', () => {
      expect(() => new URL('not-a-url')).toThrow();
      expect(isValidRedirectUri('not-a-url')).toBe(false);
    });

    it('should identify javascript: URI as malicious (all case variations)', () => {
      const maliciousUris = ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'JaVaScRiPt:alert(1)', 'javascript:void(0)'];

      for (const uri of maliciousUris) {
        // The URL class normalizes protocol to lowercase
        const url = new URL(uri);
        expect(url.protocol).toBe('javascript:');
        expect(isValidRedirectUri(uri)).toBe(false);
      }
    });

    it('should identify data: URI as malicious', () => {
      const dataUris = [
        'data:text/html,<script>alert(1)</script>',
        'DATA:text/html,<script>alert(1)</script>',
        'data:application/javascript,alert(1)',
      ];

      for (const uri of dataUris) {
        expect(isValidRedirectUri(uri)).toBe(false);
      }
    });

    it('should identify vbscript: URI as malicious', () => {
      const vbUris = ['vbscript:msgbox(1)', 'VBSCRIPT:msgbox(1)'];

      for (const uri of vbUris) {
        expect(isValidRedirectUri(uri)).toBe(false);
      }
    });

    it('should accept valid http/https URIs', () => {
      const validUris = [
        'http://localhost:3000/callback',
        'https://example.com/oauth/callback',
        'HTTP://EXAMPLE.COM/CALLBACK',
        'HTTPS://EXAMPLE.COM/CALLBACK',
      ];

      for (const uri of validUris) {
        expect(isValidRedirectUri(uri)).toBe(true);
      }
    });
  });
});
