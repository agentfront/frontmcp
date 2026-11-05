import { MCP_ERROR_CODES, PublicMcpError } from '../mcp.error';
import { ToolCredentialsRequiredError } from '../tool-credentials-required.error';

const CONNECT_URL = 'https://server/oauth/connect?token=signed';

describe('ToolCredentialsRequiredError', () => {
  it('is a public -32001 error', () => {
    const error = new ToolCredentialsRequiredError({ toolId: 'deploy', providers: ['github'] });

    expect(error).toBeInstanceOf(PublicMcpError);
    expect(error.mcpErrorCode).toBe(MCP_ERROR_CODES.UNAUTHORIZED);
    expect(error.code).toBe('TOOL_CREDENTIALS_REQUIRED');
  });

  it('keeps the connect URL in its data, out of the message', () => {
    const error = new ToolCredentialsRequiredError({
      toolId: 'deploy',
      providers: ['github', 'aws'],
      authUrl: CONNECT_URL,
    });

    expect(error.toJsonRpcError()).toEqual({
      code: -32001,
      message:
        'Tool "deploy" requires credentials for github, aws which are not connected for this session. ' +
        "Connect github, aws to continue: open the link in this error's data (authUrl).",
      data: { tool: 'deploy', providers: ['github', 'aws'], authUrl: CONNECT_URL, auth_url: CONNECT_URL },
    });
    expect(error.message).not.toContain(CONNECT_URL);
  });

  it('asks a caller that is not signed in to sign in, with no connect URL', () => {
    const error = new ToolCredentialsRequiredError({ toolId: 'deploy', providers: ['github'], signInRequired: true });

    expect(error.signInRequired).toBe(true);
    expect(error.toJsonRpcError()).toEqual({
      code: -32001,
      message:
        'Tool "deploy" requires credentials for github, and this caller isn\'t signed in. ' +
        'Sign in to this server, then connect github.',
      data: { tool: 'deploy', providers: ['github'], signInRequired: true },
    });
  });

  it('says to authorize the providers when there is no connect URL', () => {
    const error = new ToolCredentialsRequiredError({ toolId: 'deploy', providers: ['github'] });

    expect(error.signInRequired).toBe(false);
    expect(error.message).toBe(
      'Tool "deploy" requires credentials for github which are not connected for this session. ' +
        'Please authorize the required provider(s) and retry.',
    );
    expect(error.toJsonRpcError().data).toEqual({ tool: 'deploy', providers: ['github'] });
  });

  it('keeps a message it is given', () => {
    const error = new ToolCredentialsRequiredError({
      toolId: 'deploy',
      providers: ['github'],
      authUrl: CONNECT_URL,
      message: 'Connect github first.',
    });

    expect(error.message).toBe('Connect github first.');
  });
});
