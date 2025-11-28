/**
 * AuthorizationRequiredError Tests
 *
 * Tests for the progressive authorization error class.
 */
import {
  AuthorizationRequiredError,
  authorizationRequiredDataSchema,
  authorizationRequiredParamsSchema,
  authorizationRequiredMetaSchema,
  AuthorizationRequiredData,
  AuthorizationRequiredParams,
  AuthorizationRequiredMeta,
  SessionMode,
  elicitResponseSchema,
} from '../authorization-required.error';
import { PublicMcpError } from '../mcp.error';

describe('AuthorizationRequiredError', () => {
  // ============================================
  // Schema Validation Tests
  // ============================================

  describe('Schemas', () => {
    describe('authorizationRequiredDataSchema', () => {
      it('should validate correct data with auth_url (stateful mode)', () => {
        const data: AuthorizationRequiredData = {
          error: 'authorization_required',
          app: 'slack',
          tool: 'slack:send_message',
          auth_url: 'https://example.com/oauth/authorize?app=slack',
          message: 'Please authorize Slack to use this tool.',
          required_scopes: ['chat:write', 'channels:read'],
          session_mode: 'stateful',
          supports_incremental: true,
        };

        const result = authorizationRequiredDataSchema.safeParse(data);
        expect(result.success).toBe(true);
      });

      it('should validate data without auth_url (stateless mode)', () => {
        const data = {
          error: 'authorization_required' as const,
          app: 'github',
          tool: 'github:create_issue',
          message: 'You are not authorized to use this tool.',
          session_mode: 'stateless' as const,
          supports_incremental: false,
        };

        const result = authorizationRequiredDataSchema.safeParse(data);
        expect(result.success).toBe(true);
      });

      it('should validate data without optional required_scopes', () => {
        const data = {
          error: 'authorization_required' as const,
          app: 'github',
          tool: 'github:create_issue',
          auth_url: 'https://example.com/oauth/authorize?app=github',
          message: 'Please authorize GitHub.',
        };

        const result = authorizationRequiredDataSchema.safeParse(data);
        expect(result.success).toBe(true);
      });

      it('should reject invalid error type', () => {
        const data = {
          error: 'invalid_error',
          app: 'slack',
          tool: 'slack:send_message',
          auth_url: 'https://example.com/oauth/authorize',
          message: 'Please authorize.',
        };

        const result = authorizationRequiredDataSchema.safeParse(data);
        expect(result.success).toBe(false);
      });

      it('should reject invalid auth_url when provided', () => {
        const data = {
          error: 'authorization_required',
          app: 'slack',
          tool: 'slack:send_message',
          auth_url: 'not-a-url',
          message: 'Please authorize.',
        };

        const result = authorizationRequiredDataSchema.safeParse(data);
        expect(result.success).toBe(false);
      });

      it('should reject empty app', () => {
        const data = {
          error: 'authorization_required',
          app: '',
          tool: 'slack:send_message',
          auth_url: 'https://example.com/oauth/authorize',
          message: 'Please authorize.',
        };

        const result = authorizationRequiredDataSchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });

    describe('authorizationRequiredParamsSchema', () => {
      it('should validate constructor params with authUrl', () => {
        const params: AuthorizationRequiredParams = {
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: '/oauth/authorize?app=slack',
          sessionMode: 'stateful',
        };

        const result = authorizationRequiredParamsSchema.safeParse(params);
        expect(result.success).toBe(true);
      });

      it('should validate params without authUrl (stateless)', () => {
        const params = {
          appId: 'slack',
          toolId: 'slack:send_message',
          sessionMode: 'stateless' as const,
        };

        const result = authorizationRequiredParamsSchema.safeParse(params);
        expect(result.success).toBe(true);
      });

      it('should validate params with all optional fields', () => {
        const params: AuthorizationRequiredParams = {
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: '/oauth/authorize?app=slack',
          requiredScopes: ['chat:write'],
          message: 'Custom message',
          sessionMode: 'stateful',
          elicitId: 'elicit-123',
          vaultId: 'vault-456',
          pendingAuthId: 'pending-789',
        };

        const result = authorizationRequiredParamsSchema.safeParse(params);
        expect(result.success).toBe(true);
      });

      it('should reject missing required fields', () => {
        const params = {
          appId: 'slack',
          // missing toolId
        };

        const result = authorizationRequiredParamsSchema.safeParse(params);
        expect(result.success).toBe(false);
      });

      it('should allow sessionMode to be optional', () => {
        const params = {
          appId: 'slack',
          toolId: 'slack:send_message',
        };

        const result = authorizationRequiredParamsSchema.safeParse(params);
        expect(result.success).toBe(true);
        if (result.success) {
          // sessionMode is optional in schema, defaults to 'stateful' in constructor
          expect(result.data.sessionMode).toBeUndefined();
        }
      });
    });

    describe('authorizationRequiredMetaSchema', () => {
      it('should validate meta object for stateful mode', () => {
        const meta: AuthorizationRequiredMeta = {
          errorId: 'err-123',
          code: 'AUTHORIZATION_REQUIRED',
          timestamp: new Date().toISOString(),
          authorization_required: true,
          app: 'slack',
          tool: 'slack:send_message',
          auth_url: '/oauth/authorize?app=slack',
          required_scopes: ['chat:write'],
          session_mode: 'stateful',
          supports_incremental: true,
        };

        const result = authorizationRequiredMetaSchema.safeParse(meta);
        expect(result.success).toBe(true);
      });

      it('should validate meta object for stateless mode', () => {
        const meta: AuthorizationRequiredMeta = {
          errorId: 'err-123',
          code: 'AUTHORIZATION_REQUIRED',
          timestamp: new Date().toISOString(),
          authorization_required: true,
          app: 'slack',
          tool: 'slack:send_message',
          session_mode: 'stateless',
          supports_incremental: false,
        };

        const result = authorizationRequiredMetaSchema.safeParse(meta);
        expect(result.success).toBe(true);
      });

      it('should validate meta without optional scopes', () => {
        const meta = {
          errorId: 'err-123',
          code: 'AUTHORIZATION_REQUIRED',
          timestamp: new Date().toISOString(),
          authorization_required: true as const,
          app: 'github',
          tool: 'github:create_issue',
          auth_url: '/oauth/authorize?app=github',
          session_mode: 'stateful' as const,
          supports_incremental: true,
        };

        const result = authorizationRequiredMetaSchema.safeParse(meta);
        expect(result.success).toBe(true);
      });
    });

    describe('elicitResponseSchema', () => {
      it('should validate elicit response', () => {
        const response = {
          elicitId: 'elicit-123',
          authUrl: 'https://example.com/oauth/authorize?app=slack',
          message: 'Please authorize Slack',
          appId: 'slack',
          toolId: 'slack:send_message',
        };

        const result = elicitResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      });

      it('should reject invalid authUrl', () => {
        const response = {
          elicitId: 'elicit-123',
          authUrl: 'not-a-url',
          message: 'Please authorize',
          appId: 'slack',
          toolId: 'slack:send_message',
        };

        const result = elicitResponseSchema.safeParse(response);
        expect(result.success).toBe(false);
      });
    });
  });

  // ============================================
  // Error Class Tests
  // ============================================

  describe('Error Class', () => {
    describe('Stateful Mode (default)', () => {
      it('should create error with default message for stateful mode', () => {
        const error = new AuthorizationRequiredError({
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: '/oauth/authorize?app=slack',
        });

        expect(error.message).toContain('slack');
        expect(error.message).toContain('slack:send_message');
        expect(error.appId).toBe('slack');
        expect(error.toolId).toBe('slack:send_message');
        expect(error.authUrl).toBe('/oauth/authorize?app=slack');
        expect(error.sessionMode).toBe('stateful');
        expect(error.supportsIncremental).toBe(true);
      });

      it('should include auth link in stateful mode', () => {
        const error = new AuthorizationRequiredError({
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: '/oauth/authorize?app=slack',
          sessionMode: 'stateful',
        });

        expect(error.authUrl).toBe('/oauth/authorize?app=slack');
        expect(error.canUseIncrementalAuth()).toBe(true);
      });
    });

    describe('Stateless Mode', () => {
      it('should create error without auth link in stateless mode', () => {
        const error = new AuthorizationRequiredError({
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: '/oauth/authorize?app=slack', // provided but should be ignored
          sessionMode: 'stateless',
        });

        expect(error.appId).toBe('slack');
        expect(error.toolId).toBe('slack:send_message');
        expect(error.authUrl).toBeUndefined(); // not set in stateless mode
        expect(error.sessionMode).toBe('stateless');
        expect(error.supportsIncremental).toBe(false);
        expect(error.canUseIncrementalAuth()).toBe(false);
      });

      it('should have different default message in stateless mode', () => {
        const error = new AuthorizationRequiredError({
          appId: 'slack',
          toolId: 'slack:send_message',
          sessionMode: 'stateless',
        });

        expect(error.message).toContain('not authorized');
        expect(error.message).toContain('re-authenticate');
      });
    });

    it('should create error with custom message', () => {
      const customMessage = 'You need to authorize Slack first!';
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: '/oauth/authorize?app=slack',
        message: customMessage,
      });

      expect(error.message).toBe(customMessage);
    });

    it('should store required scopes', () => {
      const scopes = ['chat:write', 'channels:read', 'users:read'];
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: '/oauth/authorize?app=slack',
        requiredScopes: scopes,
      });

      expect(error.requiredScopes).toEqual(scopes);
    });

    it('should store elicit and vault IDs', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: '/oauth/authorize?app=slack',
        elicitId: 'elicit-123',
        vaultId: 'vault-456',
        pendingAuthId: 'pending-789',
      });

      expect(error.elicitId).toBe('elicit-123');
      expect(error.vaultId).toBe('vault-456');
      expect(error.pendingAuthId).toBe('pending-789');
    });

    it('should extend PublicMcpError', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: '/oauth/authorize?app=slack',
      });

      expect(error).toBeInstanceOf(PublicMcpError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct error code', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: '/oauth/authorize?app=slack',
      });

      expect(error.code).toBe('AUTHORIZATION_REQUIRED');
    });

    it('should have status code 403', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: '/oauth/authorize?app=slack',
      });

      expect(error.statusCode).toBe(403);
    });
  });

  // ============================================
  // toMcpError Tests
  // ============================================

  describe('toMcpError', () => {
    describe('Stateful Mode', () => {
      it('should return properly formatted MCP error response', () => {
        const error = new AuthorizationRequiredError({
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: '/oauth/authorize?app=slack',
          requiredScopes: ['chat:write'],
        });

        const mcpError = error.toMcpError();

        expect(mcpError.isError).toBe(true);
        expect(mcpError.content).toHaveLength(1);
        expect(mcpError.content[0].type).toBe('text');
        expect(mcpError.content[0].text).toContain('/oauth/authorize?app=slack');
      });

      it('should include authorization_required metadata with auth_url', () => {
        const error = new AuthorizationRequiredError({
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: '/oauth/authorize?app=slack',
          requiredScopes: ['chat:write'],
        });

        const mcpError = error.toMcpError();

        expect(mcpError._meta.authorization_required).toBe(true);
        expect(mcpError._meta.app).toBe('slack');
        expect(mcpError._meta.tool).toBe('slack:send_message');
        expect(mcpError._meta.auth_url).toBe('/oauth/authorize?app=slack');
        expect(mcpError._meta.required_scopes).toEqual(['chat:write']);
        expect(mcpError._meta.session_mode).toBe('stateful');
        expect(mcpError._meta.supports_incremental).toBe(true);
      });
    });

    describe('Stateless Mode', () => {
      it('should not include auth_url in stateless mode', () => {
        const error = new AuthorizationRequiredError({
          appId: 'slack',
          toolId: 'slack:send_message',
          sessionMode: 'stateless',
        });

        const mcpError = error.toMcpError();

        expect(mcpError._meta.auth_url).toBeUndefined();
        expect(mcpError._meta.session_mode).toBe('stateless');
        expect(mcpError._meta.supports_incremental).toBe(false);
        expect(mcpError.content[0].text).toContain('re-authenticate');
      });
    });

    it('should include error ID and code in metadata', () => {
      const error = new AuthorizationRequiredError({
        appId: 'github',
        toolId: 'github:create_issue',
        authUrl: '/oauth/authorize?app=github',
      });

      const mcpError = error.toMcpError();

      expect(mcpError._meta.errorId).toBeDefined();
      expect(mcpError._meta.code).toBe('AUTHORIZATION_REQUIRED');
      expect(mcpError._meta.timestamp).toBeDefined();
    });

    it('should include elicit and pending auth IDs when provided', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: '/oauth/authorize?app=slack',
        elicitId: 'elicit-123',
        pendingAuthId: 'pending-456',
      });

      const mcpError = error.toMcpError();

      expect(mcpError._meta.elicit_id).toBe('elicit-123');
      expect(mcpError._meta.pending_auth_id).toBe('pending-456');
    });

    it('should validate against meta schema (stateful)', () => {
      const error = new AuthorizationRequiredError({
        appId: 'salesforce',
        toolId: 'salesforce:query',
        authUrl: '/oauth/authorize?app=salesforce',
        requiredScopes: ['api', 'refresh_token'],
      });

      const mcpError = error.toMcpError();
      const result = authorizationRequiredMetaSchema.safeParse(mcpError._meta);

      expect(result.success).toBe(true);
    });

    it('should validate against meta schema (stateless)', () => {
      const error = new AuthorizationRequiredError({
        appId: 'salesforce',
        toolId: 'salesforce:query',
        sessionMode: 'stateless',
      });

      const mcpError = error.toMcpError();
      const result = authorizationRequiredMetaSchema.safeParse(mcpError._meta);

      expect(result.success).toBe(true);
    });
  });

  // ============================================
  // toAuthorizationRequiredData Tests
  // ============================================

  describe('toAuthorizationRequiredData', () => {
    it('should return structured authorization required data (stateful)', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: 'https://example.com/oauth/authorize?app=slack',
        requiredScopes: ['chat:write', 'channels:read'],
      });

      const data = error.toAuthorizationRequiredData();

      expect(data.error).toBe('authorization_required');
      expect(data.app).toBe('slack');
      expect(data.tool).toBe('slack:send_message');
      expect(data.auth_url).toBe('https://example.com/oauth/authorize?app=slack');
      expect(data.required_scopes).toEqual(['chat:write', 'channels:read']);
      expect(data.message).toBeDefined();
      expect(data.session_mode).toBe('stateful');
      expect(data.supports_incremental).toBe(true);
    });

    it('should return structured data without auth_url (stateless)', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        sessionMode: 'stateless',
      });

      const data = error.toAuthorizationRequiredData();

      expect(data.error).toBe('authorization_required');
      expect(data.app).toBe('slack');
      expect(data.auth_url).toBeUndefined();
      expect(data.session_mode).toBe('stateless');
      expect(data.supports_incremental).toBe(false);
    });

    it('should validate against data schema', () => {
      const error = new AuthorizationRequiredError({
        appId: 'github',
        toolId: 'github:create_issue',
        authUrl: 'https://example.com/oauth/authorize?app=github',
      });

      const data = error.toAuthorizationRequiredData();
      const result = authorizationRequiredDataSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('should handle undefined requiredScopes', () => {
      const error = new AuthorizationRequiredError({
        appId: 'jira',
        toolId: 'jira:create_ticket',
        authUrl: 'https://example.com/oauth/authorize?app=jira',
      });

      const data = error.toAuthorizationRequiredData();

      expect(data.required_scopes).toBeUndefined();
    });
  });

  // ============================================
  // toElicitResponse Tests
  // ============================================

  describe('toElicitResponse', () => {
    it('should return elicit response when all required fields present', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: 'https://example.com/oauth/authorize?app=slack',
        elicitId: 'elicit-123',
        sessionMode: 'stateful',
      });

      const elicitResponse = error.toElicitResponse();

      expect(elicitResponse).not.toBeNull();
      expect(elicitResponse?.elicitId).toBe('elicit-123');
      expect(elicitResponse?.authUrl).toBe('https://example.com/oauth/authorize?app=slack');
      expect(elicitResponse?.appId).toBe('slack');
      expect(elicitResponse?.toolId).toBe('slack:send_message');
    });

    it('should return null when elicitId not provided', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: 'https://example.com/oauth/authorize?app=slack',
        sessionMode: 'stateful',
      });

      const elicitResponse = error.toElicitResponse();
      expect(elicitResponse).toBeNull();
    });

    it('should return null in stateless mode', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        elicitId: 'elicit-123',
        sessionMode: 'stateless',
      });

      const elicitResponse = error.toElicitResponse();
      expect(elicitResponse).toBeNull();
    });

    it('should validate against elicit response schema', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: 'https://example.com/oauth/authorize?app=slack',
        elicitId: 'elicit-123',
        sessionMode: 'stateful',
      });

      const elicitResponse = error.toElicitResponse();
      const result = elicitResponseSchema.safeParse(elicitResponse);

      expect(result.success).toBe(true);
    });
  });

  // ============================================
  // getUserFacingMessage Tests
  // ============================================

  describe('getUserFacingMessage', () => {
    it('should include auth link in stateful mode', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: 'https://example.com/oauth/authorize?app=slack',
        sessionMode: 'stateful',
      });

      const message = error.getUserFacingMessage();
      expect(message).toContain('Click here to authorize');
      expect(message).toContain('https://example.com/oauth/authorize?app=slack');
    });

    it('should tell user to re-authenticate in stateless mode', () => {
      const error = new AuthorizationRequiredError({
        appId: 'slack',
        toolId: 'slack:send_message',
        sessionMode: 'stateless',
      });

      const message = error.getUserFacingMessage();
      expect(message).toContain('re-authenticate');
      expect(message).not.toContain('Click here');
    });
  });

  // ============================================
  // getCancelledMessage Static Method Tests
  // ============================================

  describe('getCancelledMessage', () => {
    it('should return message with retry link when authUrl provided', () => {
      const message = AuthorizationRequiredError.getCancelledMessage(
        'slack',
        'slack:send_message',
        'https://example.com/oauth/authorize?app=slack',
      );

      expect(message).toContain('Authorization was cancelled');
      expect(message).toContain('click this link');
      expect(message).toContain('re-prompt');
    });

    it('should return message without link when authUrl not provided', () => {
      const message = AuthorizationRequiredError.getCancelledMessage('slack', 'slack:send_message');

      expect(message).toContain('Authorization was cancelled');
      expect(message).toContain('re-authenticate');
      expect(message).not.toContain('click this link');
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe('Integration', () => {
    it('should work with try/catch pattern (stateful)', () => {
      const checkAuth = (isAuthorized: boolean, sessionMode: SessionMode = 'stateful') => {
        if (!isAuthorized) {
          throw new AuthorizationRequiredError({
            appId: 'slack',
            toolId: 'slack:send_message',
            authUrl: '/oauth/authorize?app=slack',
            sessionMode,
          });
        }
        return { success: true };
      };

      try {
        checkAuth(false);
        fail('Should have thrown');
      } catch (error) {
        if (error instanceof AuthorizationRequiredError) {
          expect(error.appId).toBe('slack');
          expect(error.authUrl).toBe('/oauth/authorize?app=slack');
          expect(error.supportsIncremental).toBe(true);
        } else {
          fail('Should be AuthorizationRequiredError');
        }
      }
    });

    it('should work with try/catch pattern (stateless)', () => {
      const checkAuth = (isAuthorized: boolean) => {
        if (!isAuthorized) {
          throw new AuthorizationRequiredError({
            appId: 'slack',
            toolId: 'slack:send_message',
            sessionMode: 'stateless',
          });
        }
        return { success: true };
      };

      try {
        checkAuth(false);
        fail('Should have thrown');
      } catch (error) {
        if (error instanceof AuthorizationRequiredError) {
          expect(error.appId).toBe('slack');
          expect(error.authUrl).toBeUndefined();
          expect(error.supportsIncremental).toBe(false);
        } else {
          fail('Should be AuthorizationRequiredError');
        }
      }
    });

    it('should preserve error chain', () => {
      const error = new AuthorizationRequiredError({
        appId: 'github',
        toolId: 'github:create_pr',
        authUrl: '/oauth/authorize?app=github',
      });

      expect(error.name).toBe('AuthorizationRequiredError');
      expect(error.stack).toBeDefined();
    });
  });
});
