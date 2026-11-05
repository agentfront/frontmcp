import 'reflect-metadata';

import {
  AuthProvidersNotConfiguredError,
  CredentialProviderAlreadyRegisteredError,
  type CredentialFactoryContext,
  type CredentialProviderConfig,
} from '@frontmcp/auth';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

@Tool({ name: 'read_github', inputSchema: {}, authProviders: ['github'] })
class ReadGithubTool extends ToolContext {
  async execute() {
    const resolved = await this.authProviders.get('github');
    const headers = await this.authProviders.headers('github');
    return {
      token: resolved?.credential.type === 'bearer' ? resolved.credential.token : null,
      authorization: headers['Authorization'] ?? null,
    };
  }
}

@Tool({ name: 'read_jira', inputSchema: {} })
class ReadJiraTool extends ToolContext {
  async execute() {
    try {
      await this.authProviders.get('jira');
      return { error: null };
    } catch (error) {
      return { error: error instanceof AuthProvidersNotConfiguredError ? error.message : String(error) };
    }
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ReadGithubTool, ReadJiraTool] })
class DeskApp {}

const factoryCalls: CredentialFactoryContext[] = [];

const github: CredentialProviderConfig = {
  name: 'github',
  scope: 'user',
  loading: 'lazy',
  factory: async (context) => {
    factoryCalls.push(context);
    return { type: 'bearer', token: `github-token-for-${context.userSub}` };
  },
};

const alice = { authContext: { user: { sub: 'alice', email: 'alice@example.com', name: 'Alice' } } };

function serverWith(extra: Record<string, unknown>): Promise<DirectMcpServer> {
  return FrontMcpInstance.createDirect({
    info: { name: 'auth-providers-wiring', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    ...extra,
  } as Parameters<typeof FrontMcpInstance.createDirect>[0]);
}

describe('@FrontMcp({ authProvidersVault })', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await serverWith({ authProvidersVault: { providers: [github] } });
  });

  afterAll(async () => server.dispose());

  it("gives a tool the caller's credential through this.authProviders.get() and headers(), from a factory told who the caller is", async () => {
    const result = await server.callTool('read_github', {}, alice);

    expect(result.structuredContent).toEqual({
      token: 'github-token-for-alice',
      authorization: 'Bearer github-token-for-alice',
    });
    expect(factoryCalls).toHaveLength(1);
    expect(factoryCalls[0]).toMatchObject({ userSub: 'alice', userEmail: 'alice@example.com', userName: 'Alice' });
  });

  it('answers null for a provider it does not register, so the session credential vault can answer instead', async () => {
    expect((await server.callTool('read_jira', {}, alice)).structuredContent).toEqual({ error: null });
  });
});

describe('this.authProviders on a server without authProvidersVault', () => {
  it('names the provider a tool asked for', async () => {
    const server = await serverWith({});
    try {
      expect((await server.callTool('read_jira', {}, alice)).structuredContent).toEqual({
        error: new AuthProvidersNotConfiguredError('jira').message,
      });
    } finally {
      await server.dispose();
    }
  });

  it('is not wired when authProvidersVault turns it off', async () => {
    const server = await serverWith({ authProvidersVault: { enabled: false, providers: [github] } });
    try {
      expect((await server.callTool('read_jira', {}, alice)).structuredContent).toEqual({
        error: new AuthProvidersNotConfiguredError('jira').message,
      });
    } finally {
      await server.dispose();
    }
  });
});

describe('authProvidersVault at startup', () => {
  it('refuses a provider name listed twice', async () => {
    await expect(serverWith({ authProvidersVault: { providers: [github, github] } })).rejects.toThrow(
      CredentialProviderAlreadyRegisteredError,
    );
  });

  it('refuses a provider entry with a field it does not take', async () => {
    await expect(serverWith({ authProvidersVault: { providers: [{ ...github, kind: 'vault' }] } })).rejects.toThrow(
      /kind/,
    );
  });
});
