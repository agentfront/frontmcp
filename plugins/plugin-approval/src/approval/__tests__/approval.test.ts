import {
  // Types
  ApprovalScope,
  ApprovalState,
  // Factories
  userGrantor,
  policyGrantor,
  adminGrantor,
  systemGrantor,
  agentGrantor,
  apiGrantor,
  oauthGrantor,
  testGrantor,
  customGrantor,
  userRevoker,
  adminRevoker,
  expiryRevoker,
  sessionEndRevoker,
  policyRevoker,
  normalizeGrantor,
  normalizeRevoker,
  // Guards
  isGrantorSource,
  isHumanGrantor,
  isAutoGrantor,
  isDelegatedGrantor,
  isApiGrantor,
  hasGrantorIdentifier,
  hasGrantorDisplayName,
  // Schemas
  approvalRecordSchema,
  approvalGrantorSchema,
  toolApprovalRequirementSchema,
  // Errors
  ApprovalError,
  ApprovalRequiredError,
  ApprovalOperationError,
  ApprovalScopeNotAllowedError,
  ApprovalExpiredError,
  ChallengeValidationError,
} from '../index';

describe('Approval module', () => {
  describe('ApprovalScope enum', () => {
    it('should have correct values', () => {
      expect(ApprovalScope.SESSION).toBe('session');
      expect(ApprovalScope.USER).toBe('user');
      expect(ApprovalScope.TIME_LIMITED).toBe('time_limited');
      expect(ApprovalScope.TOOL_SPECIFIC).toBe('tool_specific');
      expect(ApprovalScope.CONTEXT_SPECIFIC).toBe('context_specific');
    });
  });

  describe('ApprovalState enum', () => {
    it('should have correct values', () => {
      expect(ApprovalState.PENDING).toBe('pending');
      expect(ApprovalState.APPROVED).toBe('approved');
      expect(ApprovalState.DENIED).toBe('denied');
      expect(ApprovalState.EXPIRED).toBe('expired');
    });
  });

  describe('Grantor factories', () => {
    describe('userGrantor', () => {
      it('should create user grantor with required fields', () => {
        const grantor = userGrantor('user-123');
        expect(grantor).toEqual({
          source: 'user',
          identifier: 'user-123',
          displayName: undefined,
          method: 'interactive',
          origin: undefined,
        });
      });

      it('should create user grantor with all fields', () => {
        const grantor = userGrantor('user-123', 'John Doe', { method: 'batch', origin: 'ui' });
        expect(grantor).toEqual({
          source: 'user',
          identifier: 'user-123',
          displayName: 'John Doe',
          method: 'batch',
          origin: 'ui',
        });
      });
    });

    describe('policyGrantor', () => {
      it('should create policy grantor', () => {
        const grantor = policyGrantor('safe-list', 'Safe Tools');
        expect(grantor).toEqual({
          source: 'policy',
          identifier: 'safe-list',
          displayName: 'Safe Tools',
          method: 'implicit',
        });
      });
    });

    describe('adminGrantor', () => {
      it('should create admin grantor', () => {
        const grantor = adminGrantor('admin-456', 'Super Admin');
        expect(grantor.source).toBe('admin');
        expect(grantor.identifier).toBe('admin-456');
        expect(grantor.displayName).toBe('Super Admin');
        expect(grantor.method).toBe('interactive');
      });
    });

    describe('systemGrantor', () => {
      it('should create system grantor with default ID', () => {
        const grantor = systemGrantor();
        expect(grantor.source).toBe('system');
        expect(grantor.identifier).toBe('system');
        expect(grantor.method).toBe('implicit');
      });

      it('should create system grantor with custom ID', () => {
        const grantor = systemGrantor('custom-system');
        expect(grantor.identifier).toBe('custom-system');
      });
    });

    describe('agentGrantor', () => {
      it('should create agent grantor with delegation', () => {
        const delegation = {
          delegatorId: 'user-123',
          delegateId: 'claude-code',
          purpose: 'code editing',
        };
        const grantor = agentGrantor('claude-code', delegation, 'Claude');
        expect(grantor.source).toBe('agent');
        expect(grantor.identifier).toBe('claude-code');
        expect(grantor.displayName).toBe('Claude');
        expect(grantor.method).toBe('delegation');
        expect(grantor.delegationContext).toEqual(delegation);
      });
    });

    describe('apiGrantor', () => {
      it('should create API grantor', () => {
        const grantor = apiGrantor('sk_live_...abc', 'GitHub Actions');
        expect(grantor.source).toBe('api');
        expect(grantor.identifier).toBe('sk_live_...abc');
        expect(grantor.displayName).toBe('GitHub Actions');
        expect(grantor.method).toBe('api');
        expect(grantor.origin).toBe('api');
      });
    });

    describe('oauthGrantor', () => {
      it('should create OAuth grantor', () => {
        const grantor = oauthGrantor('token-xyz', 'Google');
        expect(grantor.source).toBe('oauth');
        expect(grantor.identifier).toBe('token-xyz');
        expect(grantor.displayName).toBe('Google');
        expect(grantor.method).toBe('api');
        expect(grantor.origin).toBe('oauth');
      });
    });

    describe('testGrantor', () => {
      it('should create test grantor', () => {
        const grantor = testGrantor();
        expect(grantor.source).toBe('test');
        expect(grantor.identifier).toBe('test');
        expect(grantor.method).toBe('implicit');
      });
    });

    describe('customGrantor', () => {
      it('should create custom grantor', () => {
        const grantor = customGrantor('frontcloud-rbac', 'role:admin', {
          displayName: 'Admin Role',
          method: 'implicit',
          origin: 'frontcloud-iam',
        });
        expect(grantor.source).toBe('frontcloud-rbac');
        expect(grantor.identifier).toBe('role:admin');
        expect(grantor.displayName).toBe('Admin Role');
        expect(grantor.method).toBe('implicit');
        expect(grantor.origin).toBe('frontcloud-iam');
      });
    });
  });

  describe('Revoker factories', () => {
    it('should create user revoker', () => {
      const revoker = userRevoker('user-123', 'John Doe');
      expect(revoker.source).toBe('user');
      expect(revoker.identifier).toBe('user-123');
      expect(revoker.displayName).toBe('John Doe');
      expect(revoker.method).toBe('interactive');
    });

    it('should create admin revoker', () => {
      const revoker = adminRevoker('admin-456');
      expect(revoker.source).toBe('admin');
      expect(revoker.method).toBe('interactive');
    });

    it('should create expiry revoker', () => {
      const revoker = expiryRevoker();
      expect(revoker.source).toBe('expiry');
      expect(revoker.method).toBe('expiry');
    });

    it('should create session end revoker', () => {
      const revoker = sessionEndRevoker('session-123');
      expect(revoker.source).toBe('session_end');
      expect(revoker.identifier).toBe('session-123');
      expect(revoker.method).toBe('implicit');
    });

    it('should create policy revoker', () => {
      const revoker = policyRevoker('policy-123', 'Security Policy');
      expect(revoker.source).toBe('policy');
      expect(revoker.identifier).toBe('policy-123');
      expect(revoker.displayName).toBe('Security Policy');
      expect(revoker.method).toBe('policy');
    });
  });

  describe('Normalization functions', () => {
    describe('normalizeGrantor', () => {
      it('should normalize string to grantor', () => {
        expect(normalizeGrantor('user')).toEqual({ source: 'user' });
        expect(normalizeGrantor('policy')).toEqual({ source: 'policy' });
      });

      it('should return grantor object as-is', () => {
        const grantor = { source: 'user', identifier: 'user-123' };
        expect(normalizeGrantor(grantor)).toBe(grantor);
      });

      it('should default to user for undefined', () => {
        expect(normalizeGrantor(undefined)).toEqual({ source: 'user' });
      });
    });

    describe('normalizeRevoker', () => {
      it('should normalize string to revoker', () => {
        expect(normalizeRevoker('expiry')).toEqual({ source: 'expiry' });
      });

      it('should return revoker object as-is', () => {
        const revoker = { source: 'admin', identifier: 'admin-123' };
        expect(normalizeRevoker(revoker)).toBe(revoker);
      });

      it('should default to user for undefined', () => {
        expect(normalizeRevoker(undefined)).toEqual({ source: 'user' });
      });
    });
  });

  describe('Guards', () => {
    describe('isGrantorSource', () => {
      it('should check grantor source', () => {
        const grantor = userGrantor('user-123');
        expect(isGrantorSource(grantor, 'user')).toBe(true);
        expect(isGrantorSource(grantor, 'admin')).toBe(false);
      });
    });

    describe('isHumanGrantor', () => {
      it('should identify human grantors', () => {
        expect(isHumanGrantor(userGrantor('user-123'))).toBe(true);
        expect(isHumanGrantor(adminGrantor('admin-123'))).toBe(true);
        expect(isHumanGrantor(policyGrantor('policy-123'))).toBe(false);
        expect(isHumanGrantor(systemGrantor())).toBe(false);
      });
    });

    describe('isAutoGrantor', () => {
      it('should identify auto grantors', () => {
        expect(isAutoGrantor(policyGrantor('policy-123'))).toBe(true);
        expect(isAutoGrantor(systemGrantor())).toBe(true);
        expect(isAutoGrantor(testGrantor())).toBe(true);
        expect(isAutoGrantor(userGrantor('user-123'))).toBe(false);
      });
    });

    describe('isDelegatedGrantor', () => {
      it('should identify delegated grantors', () => {
        const delegation = { delegatorId: 'user-123', delegateId: 'agent-1' };
        expect(isDelegatedGrantor(agentGrantor('agent-1', delegation))).toBe(true);
        expect(isDelegatedGrantor(userGrantor('user-123'))).toBe(false);
      });
    });

    describe('isApiGrantor', () => {
      it('should identify API grantors', () => {
        expect(isApiGrantor(apiGrantor('key-123'))).toBe(true);
        expect(isApiGrantor(oauthGrantor('token-123'))).toBe(true);
        expect(isApiGrantor(userGrantor('user-123'))).toBe(false);
      });
    });

    describe('hasGrantorIdentifier', () => {
      it('should check for identifier', () => {
        expect(hasGrantorIdentifier(userGrantor('user-123'))).toBe(true);
        expect(hasGrantorIdentifier({ source: 'user' })).toBe(false);
        expect(hasGrantorIdentifier({ source: 'user', identifier: '' })).toBe(false);
      });
    });

    describe('hasGrantorDisplayName', () => {
      it('should check for display name', () => {
        expect(hasGrantorDisplayName(userGrantor('user-123', 'John'))).toBe(true);
        expect(hasGrantorDisplayName(userGrantor('user-123'))).toBe(false);
        expect(hasGrantorDisplayName({ source: 'user', displayName: '' })).toBe(false);
      });
    });
  });

  describe('Schemas', () => {
    describe('approvalGrantorSchema', () => {
      it('should validate valid grantor', () => {
        const result = approvalGrantorSchema.safeParse({
          source: 'user',
          identifier: 'user-123',
          displayName: 'John Doe',
          method: 'interactive',
        });
        expect(result.success).toBe(true);
      });

      it('should accept minimal grantor', () => {
        const result = approvalGrantorSchema.safeParse({ source: 'test' });
        expect(result.success).toBe(true);
      });

      it('should reject empty source', () => {
        const result = approvalGrantorSchema.safeParse({ source: '' });
        expect(result.success).toBe(false);
      });
    });

    describe('approvalRecordSchema', () => {
      it('should validate complete approval record', () => {
        const record = {
          toolId: 'file_write',
          state: ApprovalState.APPROVED,
          scope: ApprovalScope.SESSION,
          grantedAt: Date.now(),
          grantedBy: { source: 'user', identifier: 'user-123' },
        };
        const result = approvalRecordSchema.safeParse(record);
        expect(result.success).toBe(true);
      });

      it('should validate record with all optional fields', () => {
        const record = {
          toolId: 'file_write',
          state: ApprovalState.APPROVED,
          scope: ApprovalScope.TIME_LIMITED,
          grantedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
          ttlMs: 3600000,
          sessionId: 'session-123',
          userId: 'user-123',
          grantedBy: { source: 'user', identifier: 'user-123' },
          approvalChain: [{ source: 'policy' }],
          reason: 'Approved for testing',
          metadata: { ip: '127.0.0.1' },
        };
        const result = approvalRecordSchema.safeParse(record);
        expect(result.success).toBe(true);
      });

      it('should reject invalid state', () => {
        const record = {
          toolId: 'file_write',
          state: 'invalid_state',
          scope: ApprovalScope.SESSION,
          grantedAt: Date.now(),
          grantedBy: { source: 'user' },
        };
        const result = approvalRecordSchema.safeParse(record);
        expect(result.success).toBe(false);
      });
    });

    describe('toolApprovalRequirementSchema', () => {
      it('should validate minimal requirement', () => {
        const result = toolApprovalRequirementSchema.safeParse({});
        expect(result.success).toBe(true);
      });

      it('should validate full requirement', () => {
        const requirement = {
          required: true,
          defaultScope: ApprovalScope.SESSION,
          allowedScopes: [ApprovalScope.SESSION, ApprovalScope.USER],
          maxTtlMs: 3600000,
          alwaysPrompt: false,
          skipApproval: false,
          approvalMessage: 'Allow this action?',
          category: 'write',
          riskLevel: 'medium',
        };
        const result = toolApprovalRequirementSchema.safeParse(requirement);
        expect(result.success).toBe(true);
      });

      it('should reject negative maxTtlMs', () => {
        const result = toolApprovalRequirementSchema.safeParse({ maxTtlMs: -1 });
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Errors', () => {
    describe('ApprovalError', () => {
      it('should create base error', () => {
        const error = new ApprovalError('test message');
        expect(error.name).toBe('ApprovalError');
        expect(error.message).toBe('test message');
        expect(error).toBeInstanceOf(Error);
      });
    });

    describe('ApprovalRequiredError', () => {
      it('should create approval required error', () => {
        const error = new ApprovalRequiredError({
          toolId: 'file_write',
          state: 'pending',
          message: 'Approval required for file write',
          approvalOptions: {
            allowedScopes: [ApprovalScope.SESSION],
            defaultScope: ApprovalScope.SESSION,
          },
        });
        expect(error.name).toBe('ApprovalRequiredError');
        expect(error.details.toolId).toBe('file_write');
        expect(error.details.state).toBe('pending');
      });

      it('should convert to JSON-RPC error', () => {
        const error = new ApprovalRequiredError({
          toolId: 'file_write',
          state: 'pending',
          message: 'Approval required',
        });
        const jsonRpc = error.toJsonRpcError();
        expect(jsonRpc.code).toBe(-32600);
        expect(jsonRpc.data.type).toBe('approval_required');
        expect(jsonRpc.data.toolId).toBe('file_write');
      });
    });

    describe('ApprovalOperationError', () => {
      it('should create operation error', () => {
        const error = new ApprovalOperationError('grant', 'Storage unavailable');
        expect(error.name).toBe('ApprovalOperationError');
        expect(error.operation).toBe('grant');
        expect(error.reason).toBe('Storage unavailable');
        expect(error.message).toBe('Approval grant failed: Storage unavailable');
      });

      it('should convert to JSON-RPC error', () => {
        const error = new ApprovalOperationError('revoke', 'Not found');
        const jsonRpc = error.toJsonRpcError();
        expect(jsonRpc.code).toBe(-32603);
        expect(jsonRpc.data.operation).toBe('revoke');
      });
    });

    describe('ApprovalScopeNotAllowedError', () => {
      it('should create scope not allowed error', () => {
        const error = new ApprovalScopeNotAllowedError(ApprovalScope.USER, [ApprovalScope.SESSION]);
        expect(error.name).toBe('ApprovalScopeNotAllowedError');
        expect(error.requestedScope).toBe(ApprovalScope.USER);
        expect(error.allowedScopes).toEqual([ApprovalScope.SESSION]);
        expect(error.message).toContain('user');
        expect(error.message).toContain('session');
      });
    });

    describe('ApprovalExpiredError', () => {
      it('should create expired error', () => {
        const expiredAt = Date.now() - 1000;
        const error = new ApprovalExpiredError('file_write', expiredAt);
        expect(error.name).toBe('ApprovalExpiredError');
        expect(error.toolId).toBe('file_write');
        expect(error.expiredAt).toBe(expiredAt);
      });
    });

    describe('ChallengeValidationError', () => {
      it('should create challenge validation error with default reason', () => {
        const error = new ChallengeValidationError();
        expect(error.name).toBe('ChallengeValidationError');
        expect(error.reason).toBe('invalid');
      });

      it('should create challenge validation error with custom reason', () => {
        const error = new ChallengeValidationError('expired', 'Challenge has expired');
        expect(error.reason).toBe('expired');
        expect(error.message).toBe('Challenge has expired');
      });

      it('should convert to JSON-RPC error', () => {
        const error = new ChallengeValidationError('not_found');
        const jsonRpc = error.toJsonRpcError();
        expect(jsonRpc.code).toBe(-32600);
        expect(jsonRpc.data.type).toBe('challenge_validation_error');
        expect(jsonRpc.data.reason).toBe('not_found');
      });
    });
  });
});
