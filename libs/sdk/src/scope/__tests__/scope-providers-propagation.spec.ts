/**
 * Issue #403 regression — `@FrontMcp({ providers })` must register the user
 * providers on the root scope so the DI parent-chain makes them visible to
 * every `@App` tool/resource/prompt/skill.
 *
 * Before the fix: `metadata.providers` was parsed onto the FrontMcpConfig but
 * never inserted into any ProviderRegistry, so app-level lookups for tokens
 * declared in `@FrontMcp({ providers })` threw "DependencyNotFound".
 */

import 'reflect-metadata';

import { ProviderScope } from '@frontmcp/di';

import { App } from '../../common/decorators/app.decorator';
import { Provider } from '../../common/decorators/provider.decorator';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

describe('Scope provider propagation (issue #403)', () => {
  it('exposes providers declared on @FrontMcp({ providers }) through scope.providers.get()', async () => {
    @Provider({ name: 'fix-403-user-service' })
    class UserService403 {
      readonly tag = 'fix-403-user-service-instance';
    }

    @App({ id: 'app-403', name: 'app-403' })
    class App403 {}

    const instance = await FrontMcpInstance.createForCli({
      info: { name: 'fix-403-test', version: '0.0.0' },
      providers: [UserService403],
      apps: [App403],
    });

    const scopes = instance.getScopes();
    expect(scopes.length).toBeGreaterThan(0);
    const scope = scopes[0] as unknown as { providers: { get: (t: unknown) => unknown } };

    const resolved = scope.providers.get(UserService403) as UserService403;
    expect(resolved).toBeInstanceOf(UserService403);
    expect(resolved.tag).toBe('fix-403-user-service-instance');
  });

  it('still works when @FrontMcp({ providers }) is omitted (back-compat)', async () => {
    @App({ id: 'app-403-noprov', name: 'app-403-noprov' })
    class AppNoProv {}

    const instance = await FrontMcpInstance.createForCli({
      info: { name: 'fix-403-noprov-test', version: '0.0.0' },
      apps: [AppNoProv],
    });

    const scopes = instance.getScopes();
    expect(scopes.length).toBeGreaterThan(0);
  });

  it('exposes a useFactory-style user provider through scope.providers.get()', async () => {
    const RESOLVED = { kind: 'from-useFactory' };
    const FACTORY_TOKEN = Symbol.for('frontmcp:test:factory-token:#403');

    @App({ id: 'app-403-factory', name: 'app-403-factory' })
    class AppFactory {}

    const instance = await FrontMcpInstance.createForCli({
      info: { name: 'fix-403-factory-test', version: '0.0.0' },
      providers: [
        {
          name: 'fix-403-factory',
          provide: FACTORY_TOKEN,
          scope: ProviderScope.GLOBAL,
          useFactory: () => RESOLVED,
          inject: [],
        },
      ],
      apps: [AppFactory],
    });

    const scopes = instance.getScopes();
    const scope = scopes[0] as unknown as { providers: { get: (t: unknown) => unknown } };

    expect(scope.providers.get(FACTORY_TOKEN)).toBe(RESOLVED);
  });

  it('does NOT let a user provider shadow framework defaults (FrontMcpLogger token)', async () => {
    // A malicious / careless user tries to override the framework-provided
    // FrontMcpLogger. The fix orders the providers as
    // `[...userProviders, ...defaultScopeProviders]` so the framework default
    // writes LAST into the underlying Map and wins the collision.
    class HostileLogger extends FrontMcpLogger {
      child(): FrontMcpLogger {
        return this;
      }
      debug() {}
      info() {}
      warn() {}
      error() {}
    }
    let factoryWasInvoked = false;

    @App({ id: 'app-403-shadow', name: 'app-403-shadow' })
    class AppShadow {}

    const instance = await FrontMcpInstance.createForCli({
      info: { name: 'fix-403-shadow-test', version: '0.0.0' },
      providers: [
        {
          name: 'hostile-logger',
          provide: FrontMcpLogger,
          scope: ProviderScope.GLOBAL,
          useFactory: () => {
            factoryWasInvoked = true;
            return new HostileLogger();
          },
          inject: [],
        },
      ],
      apps: [AppShadow],
    });

    const scope = instance.getScopes()[0] as unknown as { providers: { get: (t: unknown) => unknown } };
    const logger = scope.providers.get(FrontMcpLogger);

    // The framework's real logger must win the Map collision — not the
    // hostile useFactory override. Either the hostile factory is never
    // invoked (because the framework default overwrote the def), or it is
    // invoked but its result is not what scope.providers.get() returns.
    expect(logger).not.toBeInstanceOf(HostileLogger);
    // factoryWasInvoked is informational — Map-set-last-wins means the
    // hostile def is dropped at buildMap time, so the factory should never
    // be invoked. Asserting it explicitly locks that in.
    expect(factoryWasInvoked).toBe(false);
  });
});
