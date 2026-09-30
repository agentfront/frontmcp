import 'reflect-metadata';

import { PublicMcpError, toMcpError } from '@frontmcp/sdk';

import {
  ApprovalError,
  ApprovalExpiredError,
  ApprovalOperationError,
  ApprovalRequiredError,
  ApprovalScopeNotAllowedError,
  ChallengeValidationError,
} from '../errors';
import { ApprovalScope } from '../types';

describe('approval errors', () => {
  describe('as public MCP errors (#647)', () => {
    const refusal = () =>
      new ApprovalRequiredError({ toolId: 'ops:deploy', state: 'pending', message: 'Deploying needs approval.' });

    it('are public MCP errors, so the SDK passes them to the client as they are', () => {
      const error = refusal();

      expect({ public: error instanceof PublicMcpError, approval: error instanceof ApprovalError }).toEqual({
        public: true,
        approval: true,
      });
      expect(toMcpError(error)).toBe(error);
    });

    it('refuses with the APPROVAL_REQUIRED code and a 403', () => {
      const error = refusal();

      expect({ code: error.code, statusCode: error.statusCode, name: error.name }).toEqual({
        code: 'APPROVAL_REQUIRED',
        statusCode: 403,
        name: 'ApprovalRequiredError',
      });
    });

    it('answers with its message alone, in production and outside it', () => {
      const error = refusal();
      const texts = [error.toMcpError(false), error.toMcpError(true)].map((result) => result.content[0].text);

      expect(texts).toEqual(['Deploying needs approval.', 'Deploying needs approval.']);
    });

    it('keeps the JSON-RPC shape of a refusal', () => {
      expect(refusal().toJsonRpcError()).toEqual({
        code: -32600,
        message: 'Deploying needs approval.',
        data: { type: 'approval_required', toolId: 'ops:deploy', state: 'pending', options: undefined },
      });
    });

    it('gives the other approval errors codes of their own', () => {
      const codes = [
        new ApprovalError('base'),
        new ApprovalOperationError('grant', 'ttlMs must be positive'),
        new ApprovalScopeNotAllowedError(ApprovalScope.USER, [ApprovalScope.SESSION]),
        new ApprovalExpiredError('ops:deploy', 0),
        new ChallengeValidationError(),
      ].map((error) => [error.name, error.code, error.statusCode]);

      expect(codes).toEqual([
        ['ApprovalError', 'APPROVAL_REQUIRED', 403],
        ['ApprovalOperationError', 'APPROVAL_OPERATION_FAILED', 400],
        ['ApprovalScopeNotAllowedError', 'APPROVAL_SCOPE_NOT_ALLOWED', 400],
        ['ApprovalExpiredError', 'APPROVAL_EXPIRED', 403],
        ['ChallengeValidationError', 'CHALLENGE_VALIDATION_FAILED', 400],
      ]);
    });
  });

  describe('ApprovalScopeNotAllowedError', () => {
    it('should create with scope and allowed scopes', () => {
      const error = new ApprovalScopeNotAllowedError(ApprovalScope.CONTEXT_SPECIFIC, [
        ApprovalScope.SESSION,
        ApprovalScope.TIME_LIMITED,
      ]);

      expect(error).toBeInstanceOf(ApprovalError);
      expect(error).toBeInstanceOf(ApprovalScopeNotAllowedError);
      expect(error.name).toBe('ApprovalScopeNotAllowedError');
      expect(error.requestedScope).toBe(ApprovalScope.CONTEXT_SPECIFIC);
      expect(error.allowedScopes).toEqual([ApprovalScope.SESSION, ApprovalScope.TIME_LIMITED]);
      expect(error.message).toContain(ApprovalScope.CONTEXT_SPECIFIC);
      expect(error.message).toContain(ApprovalScope.SESSION);
    });

    it('should produce correct JSON-RPC error', () => {
      const error = new ApprovalScopeNotAllowedError(ApprovalScope.CONTEXT_SPECIFIC, [ApprovalScope.SESSION]);
      const rpc = error.toJsonRpcError();

      expect(rpc.code).toBe(-32602);
      expect(rpc.data.type).toBe('approval_scope_not_allowed');
      expect(rpc.data.requestedScope).toBe(ApprovalScope.CONTEXT_SPECIFIC);
      expect(rpc.data.allowedScopes).toEqual([ApprovalScope.SESSION]);
    });
  });

  describe('ChallengeValidationError', () => {
    it('should create with default reason', () => {
      const error = new ChallengeValidationError();

      expect(error).toBeInstanceOf(ApprovalError);
      expect(error).toBeInstanceOf(ChallengeValidationError);
      expect(error.name).toBe('ChallengeValidationError');
      expect(error.reason).toBe('invalid');
      expect(error.message).toContain('invalid');
    });

    it('should create with explicit reason', () => {
      const error = new ChallengeValidationError('expired');

      expect(error.reason).toBe('expired');
      expect(error.message).toContain('expired');
    });

    it('should create with custom message', () => {
      const error = new ChallengeValidationError('not_found', 'Challenge does not exist');

      expect(error.reason).toBe('not_found');
      expect(error.message).toBe('Challenge does not exist');
    });

    it('should create with already_used reason', () => {
      const error = new ChallengeValidationError('already_used');

      expect(error.reason).toBe('already_used');
    });

    it('should produce correct JSON-RPC error', () => {
      const error = new ChallengeValidationError('expired', 'Challenge expired');
      const rpc = error.toJsonRpcError();

      expect(rpc.code).toBe(-32600);
      expect(rpc.data.type).toBe('challenge_validation_error');
      expect(rpc.data.reason).toBe('expired');
    });
  });

  describe('ApprovalExpiredError', () => {
    it('should create with toolId and expiredAt', () => {
      const expiredAt = Date.now() - 60_000;
      const error = new ApprovalExpiredError('my-tool', expiredAt);

      expect(error).toBeInstanceOf(ApprovalError);
      expect(error.name).toBe('ApprovalExpiredError');
      expect(error.toolId).toBe('my-tool');
      expect(error.expiredAt).toBe(expiredAt);
      expect(error.message).toContain('my-tool');
    });

    it('should produce correct JSON-RPC error', () => {
      const expiredAt = Date.now();
      const error = new ApprovalExpiredError('tool-x', expiredAt);
      const rpc = error.toJsonRpcError();

      expect(rpc.code).toBe(-32600);
      expect(rpc.data.type).toBe('approval_expired');
      expect(rpc.data.toolId).toBe('tool-x');
      expect(rpc.data.expiredAt).toBe(expiredAt);
    });
  });
});
