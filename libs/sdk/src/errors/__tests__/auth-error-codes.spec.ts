import 'reflect-metadata';

import { AuthProvidersNotConfiguredError, VaultLoadError } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Prompt, PromptContext, Tool, ToolContext } from '../../common';
import { isClientFacingError, toMcpError } from '../mcp.error';

const STORAGE_DETAIL = 'connect ECONNREFUSED 10.0.3.7:6379';
const FAKE_SESSION_SECRET = 'auth-error-codes-spec-fake-session-secret-0123';

@Tool({ name: 'read_token', inputSchema: { failure: z.string() } })
class ReadTokenTool extends ToolContext {
  async execute({ failure }: { failure: string }) {
    if (failure === 'vault') throw new VaultLoadError('vault-1', new Error(STORAGE_DETAIL));
    const resolved = await this.authProviders.get('jira');
    return { found: resolved !== null };
  }
}

@Prompt({ name: 'credentials', arguments: [] })
class CredentialsPrompt extends PromptContext {
  async execute(): Promise<never> {
    throw new VaultLoadError('vault-1', new Error(STORAGE_DETAIL));
  }
}

@App({ id: 'desk', name: 'desk', tools: [ReadTokenTool], prompts: [CredentialsPrompt] })
class DeskApp {}

describe('@frontmcp/auth errors keep their codes (#1162)', () => {
  it('converts a public auth error to a public MCP error with its code, message and error ID', () => {
    const authError = new AuthProvidersNotConfiguredError('jira');
    const converted = toMcpError(authError);

    expect(converted.isPublic).toBe(true);
    expect(converted.code).toBe('AUTH_PROVIDERS_NOT_CONFIGURED');
    expect(converted.getPublicMessage()).toBe(authError.message);
    expect(converted.errorId).toBe(authError.errorId);
    expect(isClientFacingError(authError)).toBe(true);
  });

  it('converts an internal auth error to an internal MCP error with its code and a masked message', () => {
    const authError = new VaultLoadError('vault-1', new Error(STORAGE_DETAIL));
    const converted = toMcpError(authError);

    expect(converted.isPublic).toBe(false);
    expect(converted.code).toBe('VAULT_LOAD_ERROR');
    expect(converted.getPublicMessage()).not.toContain('ECONNREFUSED');
    expect(converted.getPublicMessage()).toContain(authError.errorId);
    expect(isClientFacingError(authError)).toBe(true);
  });

  describe('on the wire, in production (2026-07-28)', () => {
    const originalNodeEnv = process.env['NODE_ENV'];
    const originalSessionSecret = process.env['MCP_SESSION_SECRET'];
    let server: TestFetchServer;

    beforeAll(async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['MCP_SESSION_SECRET'] = FAKE_SESSION_SECRET;
      server = await createTestFetchServer({ info: { name: 'auth-error-codes', version: '1.0.0' }, apps: [DeskApp] });
    });

    afterAll(() => {
      if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = originalNodeEnv;
      if (originalSessionSecret === undefined) delete process.env['MCP_SESSION_SECRET'];
      else process.env['MCP_SESSION_SECRET'] = originalSessionSecret;
    });

    async function callTool(failure: string) {
      const { message } = await rpc20260728(server.handler, 'tools/call', {
        name: 'read_token',
        arguments: { failure },
      });
      const result = message.result as {
        isError?: boolean;
        content: Array<{ text: string }>;
        _meta?: { code?: string };
      };
      return { isError: result.isError, code: result._meta?.code, text: result.content[0]?.text };
    }

    it('answers this.authProviders on a server without auth providers with AUTH_PROVIDERS_NOT_CONFIGURED', async () => {
      expect(await callTool('providers')).toEqual({
        isError: true,
        code: 'AUTH_PROVIDERS_NOT_CONFIGURED',
        text: new AuthProvidersNotConfiguredError('jira').message,
      });
    });

    it("answers a tool's VaultLoadError with VAULT_LOAD_ERROR, without the storage detail", async () => {
      const result = await callTool('vault');

      expect(result).toMatchObject({ isError: true, code: 'VAULT_LOAD_ERROR' });
      expect(result.text).not.toContain('ECONNREFUSED');
    });

    it("answers a prompt's VaultLoadError with VAULT_LOAD_ERROR in the JSON-RPC error data", async () => {
      const { message } = await rpc20260728(server.handler, 'prompts/get', { name: 'credentials', arguments: {} });

      expect(message.error?.code).toBe(-32603);
      expect(message.error?.data).toMatchObject({ code: 'VAULT_LOAD_ERROR' });
      expect(message.error?.message).not.toContain('ECONNREFUSED');
    });
  });
});
