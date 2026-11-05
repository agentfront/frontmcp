// file: libs/sdk/src/skill/errors/skill-bundle-not-loaded.error.ts

import { MCP_ERROR_CODES, PublicMcpError } from '../../errors';

/**
 * The skills a plugin registers at runtime (a skill bundle) aren't loaded yet: the first load is running, or it
 * failed. The SDK's skill surfaces and the plugin's own tools answer with it instead of an empty catalog. It is
 * retryable: `data.retryable` in a JSON-RPC error, `_meta.retryable` in a tool result.
 */
export class SkillBundleNotLoadedError extends PublicMcpError {
  constructor(reason: string) {
    super(`No skill bundle is loaded: ${reason}`, 'SKILL_BUNDLE_NOT_LOADED', 503);
  }

  toJsonRpcError(): { code: number; message: string; data: Record<string, unknown> } {
    return {
      code: MCP_ERROR_CODES.INTERNAL_ERROR,
      message: this.getPublicMessage(),
      data: { code: this.code, retryable: true },
    };
  }

  override toMcpError(isDevelopment = false): ReturnType<PublicMcpError['toMcpError']> {
    const response = super.toMcpError(isDevelopment);
    return response._meta ? { ...response, _meta: { ...response._meta, retryable: true } } : response;
  }
}
