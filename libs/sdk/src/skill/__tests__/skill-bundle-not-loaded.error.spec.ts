import { McpError } from '@frontmcp/protocol';

import { MCP_ERROR_CODES, PublicMcpError } from '../../errors';
import { toSdkMcpError } from '../../transport/mcp-handlers/mcp-error.utils';
import { SkillBundleNotLoadedError } from '../errors/skill-bundle-not-loaded.error';

describe('SkillBundleNotLoadedError', () => {
  const error = new SkillBundleNotLoadedError('the first bundle has not loaded yet');

  it('is a public 503 error with the SKILL_BUNDLE_NOT_LOADED code and the reason in its message', () => {
    expect(error).toBeInstanceOf(PublicMcpError);
    expect(error).toBeInstanceOf(SkillBundleNotLoadedError);
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('SKILL_BUNDLE_NOT_LOADED');
    expect(error.message).toBe('No skill bundle is loaded: the first bundle has not loaded yet');
  });

  it('answers a JSON-RPC request with its code and retryable in data, and its error id', () => {
    const answered = toSdkMcpError(error);

    expect(answered).toBeInstanceOf(McpError);
    expect(answered.code).toBe(MCP_ERROR_CODES.INTERNAL_ERROR);
    expect(answered.message).toContain('No skill bundle is loaded: the first bundle has not loaded yet');
    expect(answered.data).toEqual({ code: 'SKILL_BUNDLE_NOT_LOADED', retryable: true, errorId: error.errorId });
  });

  it('answers a tool call with the same text, and retryable in _meta', () => {
    const result = error.toMcpError();

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'No skill bundle is loaded: the first bundle has not loaded yet' },
    ]);
    expect(result._meta).toMatchObject({ code: 'SKILL_BUNDLE_NOT_LOADED', errorId: error.errorId, retryable: true });
  });
});
