import 'reflect-metadata';
import {
  approvalScopeSchema,
  approvalStateSchema,
  approvalMethodSchema,
  approvalSourceTypeSchema,
  revocationMethodSchema,
  approvalCategorySchema,
  riskLevelSchema,
  approvalContextSchema,
  delegationContextSchema,
  approvalGrantorSchema,
  approvalRevokerSchema,
  approvalRecordSchema,
  toolApprovalRequirementSchema,
} from '../schemas';
import { ApprovalScope, ApprovalState } from '../types';

describe('approval schemas', () => {
  describe('approvalScopeSchema', () => {
    it('should accept valid scope values', () => {
      expect(approvalScopeSchema.parse(ApprovalScope.SESSION)).toBe(ApprovalScope.SESSION);
      expect(approvalScopeSchema.parse(ApprovalScope.USER)).toBe(ApprovalScope.USER);
      expect(approvalScopeSchema.parse(ApprovalScope.TIME_LIMITED)).toBe(ApprovalScope.TIME_LIMITED);
      expect(approvalScopeSchema.parse(ApprovalScope.TOOL_SPECIFIC)).toBe(ApprovalScope.TOOL_SPECIFIC);
      expect(approvalScopeSchema.parse(ApprovalScope.CONTEXT_SPECIFIC)).toBe(ApprovalScope.CONTEXT_SPECIFIC);
    });

    it('should reject invalid scope values', () => {
      expect(() => approvalScopeSchema.parse('invalid')).toThrow();
      expect(() => approvalScopeSchema.parse(123)).toThrow();
      expect(() => approvalScopeSchema.parse(null)).toThrow();
    });
  });

  describe('approvalStateSchema', () => {
    it('should accept valid state values', () => {
      expect(approvalStateSchema.parse(ApprovalState.PENDING)).toBe(ApprovalState.PENDING);
      expect(approvalStateSchema.parse(ApprovalState.APPROVED)).toBe(ApprovalState.APPROVED);
      expect(approvalStateSchema.parse(ApprovalState.DENIED)).toBe(ApprovalState.DENIED);
      expect(approvalStateSchema.parse(ApprovalState.EXPIRED)).toBe(ApprovalState.EXPIRED);
    });

    it('should reject invalid state values', () => {
      expect(() => approvalStateSchema.parse('invalid')).toThrow();
    });
  });

  describe('approvalMethodSchema', () => {
    it('should accept valid method values', () => {
      expect(approvalMethodSchema.parse('interactive')).toBe('interactive');
      expect(approvalMethodSchema.parse('implicit')).toBe('implicit');
      expect(approvalMethodSchema.parse('delegation')).toBe('delegation');
      expect(approvalMethodSchema.parse('batch')).toBe('batch');
      expect(approvalMethodSchema.parse('api')).toBe('api');
    });

    it('should reject invalid method values', () => {
      expect(() => approvalMethodSchema.parse('invalid')).toThrow();
    });
  });

  describe('approvalSourceTypeSchema', () => {
    it('should accept non-empty strings', () => {
      expect(approvalSourceTypeSchema.parse('user')).toBe('user');
      expect(approvalSourceTypeSchema.parse('system')).toBe('system');
    });

    it('should reject empty strings', () => {
      expect(() => approvalSourceTypeSchema.parse('')).toThrow();
    });
  });

  describe('revocationMethodSchema', () => {
    it('should accept valid revocation methods', () => {
      expect(revocationMethodSchema.parse('interactive')).toBe('interactive');
      expect(revocationMethodSchema.parse('implicit')).toBe('implicit');
      expect(revocationMethodSchema.parse('policy')).toBe('policy');
      expect(revocationMethodSchema.parse('expiry')).toBe('expiry');
    });

    it('should reject invalid methods', () => {
      expect(() => revocationMethodSchema.parse('invalid')).toThrow();
    });
  });

  describe('approvalCategorySchema', () => {
    it('should accept valid categories', () => {
      expect(approvalCategorySchema.parse('read')).toBe('read');
      expect(approvalCategorySchema.parse('write')).toBe('write');
      expect(approvalCategorySchema.parse('delete')).toBe('delete');
      expect(approvalCategorySchema.parse('execute')).toBe('execute');
      expect(approvalCategorySchema.parse('admin')).toBe('admin');
    });

    it('should reject invalid categories', () => {
      expect(() => approvalCategorySchema.parse('invalid')).toThrow();
    });
  });

  describe('riskLevelSchema', () => {
    it('should accept valid risk levels', () => {
      expect(riskLevelSchema.parse('low')).toBe('low');
      expect(riskLevelSchema.parse('medium')).toBe('medium');
      expect(riskLevelSchema.parse('high')).toBe('high');
      expect(riskLevelSchema.parse('critical')).toBe('critical');
    });

    it('should reject invalid risk levels', () => {
      expect(() => riskLevelSchema.parse('invalid')).toThrow();
    });
  });

  describe('approvalContextSchema', () => {
    it('should accept valid context objects', () => {
      const result = approvalContextSchema.parse({
        type: 'project',
        identifier: 'proj-123',
      });
      expect(result.type).toBe('project');
      expect(result.identifier).toBe('proj-123');
    });

    it('should accept context with optional metadata', () => {
      const result = approvalContextSchema.parse({
        type: 'project',
        identifier: 'proj-123',
        metadata: { foo: 'bar' },
      });
      expect(result.metadata).toEqual({ foo: 'bar' });
    });

    it('should reject empty type or identifier', () => {
      expect(() => approvalContextSchema.parse({ type: '', identifier: 'x' })).toThrow();
      expect(() => approvalContextSchema.parse({ type: 'x', identifier: '' })).toThrow();
    });

    it('should reject missing required fields', () => {
      expect(() => approvalContextSchema.parse({ type: 'project' })).toThrow();
      expect(() => approvalContextSchema.parse({ identifier: 'proj-123' })).toThrow();
    });
  });

  describe('delegationContextSchema', () => {
    it('should accept valid delegation context', () => {
      const result = delegationContextSchema.parse({
        delegatorId: 'user-1',
        delegateId: 'user-2',
      });
      expect(result.delegatorId).toBe('user-1');
      expect(result.delegateId).toBe('user-2');
    });

    it('should accept optional fields', () => {
      const result = delegationContextSchema.parse({
        delegatorId: 'user-1',
        delegateId: 'user-2',
        purpose: 'testing',
        constraints: { maxCalls: 10 },
      });
      expect(result.purpose).toBe('testing');
      expect(result.constraints).toEqual({ maxCalls: 10 });
    });

    it('should reject empty delegator or delegate IDs', () => {
      expect(() => delegationContextSchema.parse({ delegatorId: '', delegateId: 'user-2' })).toThrow();
      expect(() => delegationContextSchema.parse({ delegatorId: 'user-1', delegateId: '' })).toThrow();
    });
  });

  describe('approvalGrantorSchema', () => {
    it('should accept valid grantor with required fields', () => {
      const result = approvalGrantorSchema.parse({
        source: 'user',
      });
      expect(result.source).toBe('user');
    });

    it('should accept all optional fields', () => {
      const result = approvalGrantorSchema.parse({
        source: 'user',
        identifier: 'user-123',
        displayName: 'John Doe',
        method: 'interactive',
        origin: 'web-ui',
        delegationContext: {
          delegatorId: 'admin',
          delegateId: 'user-123',
        },
      });
      expect(result.identifier).toBe('user-123');
      expect(result.displayName).toBe('John Doe');
      expect(result.method).toBe('interactive');
      expect(result.origin).toBe('web-ui');
      expect(result.delegationContext?.delegatorId).toBe('admin');
    });
  });

  describe('approvalRevokerSchema', () => {
    it('should accept valid revoker', () => {
      const result = approvalRevokerSchema.parse({
        source: 'system',
      });
      expect(result.source).toBe('system');
    });

    it('should accept optional fields', () => {
      const result = approvalRevokerSchema.parse({
        source: 'user',
        identifier: 'admin-1',
        displayName: 'Admin',
        method: 'interactive',
      });
      expect(result.method).toBe('interactive');
    });
  });

  describe('approvalRecordSchema', () => {
    const validRecord = {
      toolId: 'my-tool',
      state: ApprovalState.APPROVED,
      scope: ApprovalScope.SESSION,
      grantedAt: Date.now(),
      grantedBy: { source: 'user' },
    };

    it('should accept valid approval record', () => {
      const result = approvalRecordSchema.parse(validRecord);
      expect(result.toolId).toBe('my-tool');
      expect(result.state).toBe(ApprovalState.APPROVED);
      expect(result.scope).toBe(ApprovalScope.SESSION);
    });

    it('should accept all optional fields', () => {
      const fullRecord = {
        ...validRecord,
        expiresAt: Date.now() + 3600000,
        ttlMs: 3600000,
        sessionId: 'session-123',
        userId: 'user-456',
        context: { type: 'project', identifier: 'proj-1' },
        approvalChain: [{ source: 'admin' }],
        reason: 'Approved for testing',
        metadata: { key: 'value' },
        revokedAt: Date.now() + 7200000,
        revokedBy: { source: 'system' },
        revocationReason: 'Expired',
      };
      const result = approvalRecordSchema.parse(fullRecord);
      expect(result.expiresAt).toBeDefined();
      expect(result.approvalChain?.length).toBe(1);
      expect(result.revokedBy?.source).toBe('system');
    });

    it('should reject invalid toolId', () => {
      expect(() => approvalRecordSchema.parse({ ...validRecord, toolId: '' })).toThrow();
    });

    it('should reject missing required fields', () => {
      expect(() => approvalRecordSchema.parse({ toolId: 'x' })).toThrow();
    });
  });

  describe('toolApprovalRequirementSchema', () => {
    it('should accept empty object (all optional)', () => {
      const result = toolApprovalRequirementSchema.parse({});
      expect(result).toEqual({});
    });

    it('should accept all fields', () => {
      const requirement = {
        required: true,
        defaultScope: ApprovalScope.SESSION,
        allowedScopes: [ApprovalScope.SESSION, ApprovalScope.USER],
        maxTtlMs: 3600000,
        alwaysPrompt: false,
        skipApproval: false,
        approvalMessage: 'Please approve',
        category: 'write',
        riskLevel: 'medium',
        preApprovedContexts: [{ type: 'project', identifier: 'trusted-proj' }],
      };
      const result = toolApprovalRequirementSchema.parse(requirement);
      expect(result.required).toBe(true);
      expect(result.allowedScopes?.length).toBe(2);
      expect(result.preApprovedContexts?.length).toBe(1);
    });

    it('should reject negative maxTtlMs', () => {
      expect(() => toolApprovalRequirementSchema.parse({ maxTtlMs: -1 })).toThrow();
      expect(() => toolApprovalRequirementSchema.parse({ maxTtlMs: 0 })).toThrow();
    });
  });
});
