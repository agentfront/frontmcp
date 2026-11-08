import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import {
  AuthProvidersNotConfiguredError,
  CredentialProviderAlreadyRegisteredError,
  type CredentialFactoryContext,
  type CredentialProviderConfig,
  type CredentialScope,
} from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';
import { MemoryStorageAdapter, mkdtemp, rm } from '@frontmcp/utils';

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

@Tool({ name: 'read_token', inputSchema: { provider: z.string() } })
class ReadTokenTool extends ToolContext {
  async execute({ provider }: { provider: string }) {
    const resolved = await this.authProviders.get(provider);
    return { token: resolved?.credential.type === 'bearer' ? resolved.credential.token : null };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ReadGithubTool, ReadJiraTool, ReadTokenTool] })
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

describe('credentials of authProvidersVault providers', () => {
  const acquired: string[] = [];

  function countingProvider(name: string, scope: CredentialScope): CredentialProviderConfig {
    return {
      name,
      scope,
      loading: 'lazy',
      factory: async () => {
        acquired.push(name);
        return { type: 'bearer', token: `${name}-${acquired.length}` };
      },
    };
  }

  const caller = (sub: string, sessionId: string) => ({ authContext: { sessionId, user: { sub } } });

  async function tokenOf(provider: string, options: ReturnType<typeof caller>): Promise<unknown> {
    const result = await server.callTool('read_token', { provider }, options);
    return (result.structuredContent as { token: unknown }).token;
  }

  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await serverWith({
      authProvidersVault: {
        providers: [
          countingProvider('openai', 'global'),
          countingProvider('jira', 'user'),
          countingProvider('notes', 'session'),
        ],
      },
    });
  });

  afterAll(async () => server.dispose());

  beforeEach(() => {
    acquired.length = 0;
  });

  it("acquire a user's credential once for that user's requests, in any session", async () => {
    const first = await tokenOf('jira', caller('alice', 'alice-session-1'));
    const second = await tokenOf('jira', caller('alice', 'alice-session-2'));
    const bobs = await tokenOf('jira', caller('bob', 'bob-session'));

    expect({ first, second, bobs }).toEqual({ first: 'jira-1', second: 'jira-1', bobs: 'jira-2' });
    expect(acquired).toEqual(['jira', 'jira']);
  });

  it('acquire a global credential once for every caller', async () => {
    const alices = await tokenOf('openai', caller('alice', 'alice-session-1'));
    const bobs = await tokenOf('openai', caller('bob', 'bob-session'));

    expect({ alices, bobs }).toEqual({ alices: 'openai-1', bobs: 'openai-1' });
    expect(acquired).toEqual(['openai']);
  });

  it("reuse a session's credential within that session, never in another", async () => {
    const first = await tokenOf('notes', caller('alice', 'session-a'));
    const again = await tokenOf('notes', caller('alice', 'session-a'));
    const otherSession = await tokenOf('notes', caller('alice', 'session-b'));

    expect({ first, again, otherSession }).toEqual({ first: 'notes-1', again: 'notes-1', otherSession: 'notes-2' });
  });

  it('keep no session credential of an anonymous caller without a verified session', async () => {
    const writes = jest.spyOn(MemoryStorageAdapter.prototype, 'set');
    const sessionWrites = () =>
      writes.mock.calls.filter(([key]) => String(key).startsWith('authproviders:session:')).length;
    const anonymous = caller('anon:visitor', '__stateless__');

    try {
      const first = await tokenOf('notes', anonymous);
      const second = await tokenOf('notes', anonymous);
      const anonymousWrites = sessionWrites();
      await tokenOf('notes', caller('alice', 'session-c'));

      expect({ first, second }).toEqual({ first: 'notes-1', second: 'notes-2' });
      expect({ anonymousWrites, verifiedWrites: sessionWrites() }).toEqual({ anonymousWrites: 0, verifiedWrites: 1 });
    } finally {
      writes.mockRestore();
    }
  });
});

describe('authProvidersVault on a server whose auth.tokenStorage is SQLite', () => {
  const acquired: string[] = [];
  const jira: CredentialProviderConfig = {
    name: 'jira',
    scope: 'user',
    loading: 'lazy',
    factory: async () => {
      acquired.push('jira');
      return { type: 'bearer', token: `jira-${acquired.length}` };
    },
  };
  const savedSecrets = { VAULT_SECRET: process.env['VAULT_SECRET'], JWT_SECRET: process.env['JWT_SECRET'] };
  let directory: string;

  beforeEach(async () => {
    acquired.length = 0;
    directory = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-auth-providers-'));
    process.env['VAULT_SECRET'] = 'auth-providers-wiring-vault-secret';
  });

  afterEach(async () => {
    for (const [name, value] of Object.entries(savedSecrets)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  async function jiraTokensOfTwoServers(vaultOptions: Record<string, unknown> = {}): Promise<unknown[]> {
    const serverOnTheSameFile = () =>
      serverWith({
        auth: { mode: 'local', tokenStorage: { sqlite: { path: path.join(directory, 'tokens.sqlite') } } },
        authProvidersVault: { providers: [jira], ...vaultOptions },
      });
    const servers = [await serverOnTheSameFile(), await serverOnTheSameFile()];
    try {
      const tokens: unknown[] = [];
      for (const server of servers) {
        const result = await server.callTool('read_token', { provider: 'jira' }, alice);
        tokens.push((result.structuredContent as { token: unknown }).token);
      }
      return tokens;
    } finally {
      await Promise.all(servers.map((server) => server.dispose()));
    }
  }

  it('gives every server on that storage the credential one of them acquired', async () => {
    expect(await jiraTokensOfTwoServers()).toEqual(['jira-1', 'jira-1']);
    expect(acquired).toEqual(['jira']);
  });

  it('keeps the credentials of each server in its own memory with useSharedStorage: false', async () => {
    expect(await jiraTokensOfTwoServers({ useSharedStorage: false })).toEqual(['jira-1', 'jira-2']);
  });

  it('keeps no credential another server can read when neither VAULT_SECRET nor JWT_SECRET is set', async () => {
    delete process.env['VAULT_SECRET'];
    delete process.env['JWT_SECRET'];

    expect(await jiraTokensOfTwoServers()).toEqual(['jira-1', 'jira-2']);
  });
});
