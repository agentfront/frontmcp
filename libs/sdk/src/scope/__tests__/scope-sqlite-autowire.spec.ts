/**
 * Issue #401 — top-level `sqlite: {...}` on `@FrontMcp` must auto-wire into
 * transport persistence, the task store, and the elicitation store (CLI mode
 * skips elicitation). A WARN should fire when sqlite is set but every
 * consuming subsystem is disabled or pre-configured with another backend.
 */

import 'reflect-metadata';

import { App } from '../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

// Mock the storage-sqlite package so unit tests don't pull in better-sqlite3.
const fakeSqliteSessionStore = { ping: undefined, close: jest.fn() };
const fakeSqliteTaskStore = { close: jest.fn() };
jest.mock(
  '@frontmcp/storage-sqlite',
  () => ({
    SqliteSessionStore: jest.fn().mockImplementation(() => fakeSqliteSessionStore),
    SqliteTaskStore: jest.fn().mockImplementation(() => fakeSqliteTaskStore),
    SqliteElicitationStore: jest.fn().mockImplementation(() => ({})),
  }),
  { virtual: true },
);

describe('Scope sqlite auto-wire (issue #401)', () => {
  it('auto-threads top-level sqlite into transport persistence', async () => {
    @App({ id: 'app-401-tp', name: 'app-401-tp' })
    class App401Tp {}

    const instance = await FrontMcpInstance.createForCli({
      info: { name: 'fix-401-transport', version: '0.0.0' },
      sqlite: { path: '/tmp/test-401-tp.sqlite' },
      apps: [App401Tp],
    });

    const scopes = instance.getScopes() as unknown as Array<{
      transportService: { isSessionStoreConfigured: () => boolean; getBackendKind: () => string | undefined };
    }>;
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes[0].transportService.isSessionStoreConfigured()).toBe(true);
    expect(scopes[0].transportService.getBackendKind()).toBe('sqlite');
  });

  it('does NOT auto-thread sqlite when transport.persistence is explicitly false', async () => {
    @App({ id: 'app-401-off', name: 'app-401-off' })
    class App401Off {}

    const instance = await FrontMcpInstance.createForCli({
      info: { name: 'fix-401-off', version: '0.0.0' },
      sqlite: { path: '/tmp/test-401-off.sqlite' },
      transport: { persistence: false },
      apps: [App401Off],
    });

    const scopes = instance.getScopes() as unknown as Array<{
      transportService: { isSessionStoreConfigured: () => boolean };
    }>;
    expect(scopes[0].transportService.isSessionStoreConfigured()).toBe(false);
  });

  it('fills in a default sqlite.path when the user omits it (CLI mode → ~/.{appName}/)', async () => {
    @App({ id: 'app-401-default', name: 'app-401-default' })
    class App401Default {}

    const instance = await FrontMcpInstance.createForCli({
      info: { name: 'fixture-default-401', version: '0.0.0' },
      sqlite: {}, // path omitted — resolver should fill it in
      apps: [App401Default],
    });

    const scope = instance.getScopes()[0] as unknown as {
      transportService: { isSessionStoreConfigured: () => boolean; getBackendKind: () => string | undefined };
    };
    expect(scope.transportService.isSessionStoreConfigured()).toBe(true);
    expect(scope.transportService.getBackendKind()).toBe('sqlite');
  });

  it('uses sqlite as the backend kind when consumed by transport persistence', async () => {
    @App({ id: 'app-401-ok', name: 'app-401-ok' })
    class App401Ok {}

    const instance = await FrontMcpInstance.createForCli({
      info: { name: 'fix-401-ok', version: '0.0.0' },
      sqlite: { path: '/tmp/test-401-ok.sqlite' },
      apps: [App401Ok],
    });

    const scope = instance.getScopes()[0] as unknown as {
      transportService: { isSessionStoreConfigured: () => boolean; getBackendKind: () => string | undefined };
    };
    expect(scope.transportService.isSessionStoreConfigured()).toBe(true);
    expect(scope.transportService.getBackendKind()).toBe('sqlite');
  });
});
