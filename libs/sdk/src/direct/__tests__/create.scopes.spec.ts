/**
 * `create()` builds one scope (#825): the server's root scope, holding the synthetic app, with the
 * config's `auth` as the server's auth. Before, the synthetic app had no `standalone`, so it got a
 * scope of its own and an empty root scope started too (a second task store, task runner, timers
 * and storage warning).
 */
import 'reflect-metadata';

import { LocalPrimaryAuth } from '../../auth/instances/instance.local-primary-auth';
import { RemotePrimaryAuth } from '../../auth/instances/instance.remote-primary-auth';
import { LogLevel, Plugin, tool, type ScopeEntry } from '../../common';
import { ToolHook } from '../../index';
import { ScopeRegistry } from '../../scope/scope.registry';
import { create } from '../create';
import { type CreateConfig } from '../create.types';

const whoami = tool({ name: 'whoami', inputSchema: {} })(async (_input, ctx) => ({
  sub: (ctx as unknown as { authInfo: { user?: { sub?: string } } }).authInfo.user?.sub ?? 'none',
}));

let auditedCalls = 0;

@Plugin({ name: 'server-audit', scope: 'server' })
class ServerAuditPlugin {
  @ToolHook.Will('execute')
  audit() {
    auditedCalls++;
  }
}

/** Create a server with `options`, and the scopes its ScopeRegistry built. */
async function serveWithScopes(options: Partial<CreateConfig> = {}) {
  const primaryScope = jest.spyOn(ScopeRegistry.prototype, 'getPrimaryScope');
  try {
    const server = await create({
      info: { name: 'help-desk', version: '1.0.0' },
      tools: [whoami],
      logging: { level: LogLevel.Off },
      ...options,
    });
    const registry = primaryScope.mock.contexts[0] as ScopeRegistry;
    return { server, scopes: registry.getScopes() };
  } finally {
    primaryScope.mockRestore();
  }
}

const describeScope = (scope: ScopeEntry) => ({
  kind: scope.record.kind,
  id: scope.id,
  apps: scope.apps.getApps().map((app) => app.id),
});

describe('create() scopes (#825)', () => {
  it('builds exactly one scope: the root scope, holding the synthetic app', async () => {
    const { server, scopes } = await serveWithScopes();
    await server.dispose();

    expect(scopes.map(describeScope)).toEqual([{ kind: 'MULTI_APP', id: 'root', apps: ['help-desk'] }]);
    expect(scopes.filter((scope) => scope.taskStore)).toHaveLength(1);
  });

  it.each([
    ['no auth', undefined, LocalPrimaryAuth],
    ['public', { mode: 'public' }, LocalPrimaryAuth],
    ['local', { mode: 'local' }, LocalPrimaryAuth],
    ['remote', { mode: 'remote', provider: 'https://idp.example.com', clientId: 'help-desk' }, LocalPrimaryAuth],
    [
      'transparent',
      { mode: 'transparent', provider: 'https://idp.example.com', expectedAudience: 'help-desk' },
      RemotePrimaryAuth,
    ],
  ])('serves create({ auth }) with %s as the server auth of its one scope', async (_label, auth, authClass) => {
    const { server, scopes } = await serveWithScopes(auth ? { auth: auth as CreateConfig['auth'] } : {});
    try {
      expect(scopes).toHaveLength(1);
      const [scope] = scopes;
      expect(scope.auth).toBeInstanceOf(authClass);
      expect(scope.auth.options.mode).toBe((auth as { mode?: string } | undefined)?.mode ?? 'public');
      // An in-process call is trusted, as it was before: it runs as the caller it names, or as `direct`
      await expect(server.callTool('whoami', {})).resolves.toEqual(
        expect.objectContaining({ structuredContent: { sub: 'direct' } }),
      );
      await expect(server.callTool('whoami', {}, { authContext: { user: { sub: 'nour' } } })).resolves.toEqual(
        expect.objectContaining({ structuredContent: { sub: 'nour' } }),
      );
    } finally {
      await server.dispose();
    }
  });

  it('installs a server-scoped plugin, whose hooks run for the server tools', async () => {
    auditedCalls = 0;
    const { server } = await serveWithScopes({ plugins: [ServerAuditPlugin] });
    await server.callTool('whoami', {});
    await server.dispose();

    expect(auditedCalls).toBe(1);
  });

  it('builds the credential vault of an auth mode that has one', async () => {
    const local = await serveWithScopes({ auth: { mode: 'local' } });
    const publicServer = await serveWithScopes({ auth: { mode: 'public' } });
    await local.server.dispose();
    await publicServer.server.dispose();

    expect((local.scopes[0].auth as LocalPrimaryAuth).credentialVault).toBeDefined();
    expect((publicServer.scopes[0].auth as LocalPrimaryAuth).credentialVault).toBeUndefined();
  });
});
