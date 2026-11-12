/**
 * A DEFAULT-scoped factory cannot depend on a CONTEXT-scoped provider, whether that provider is
 * registered next to it or in a parent registry, or the factory is added later: it would build one
 * caller's instance and keep it for every caller.
 */
import 'reflect-metadata';

import { App, LogLevel, Provider, ProviderScope } from '../../common';
import { InvalidDependencyScopeError } from '../../errors';
import { createContainer } from '../create-container';
import ProviderRegistry from '../provider.registry';

const quiet = { level: LogLevel.Off, enableConsole: false };

@Provider({ name: 'caller-session', scope: ProviderScope.CONTEXT })
class CallerSession {
  readonly id = Math.random().toString(36);
}

const SHARED_REPORT = Symbol('shared-report');
const sharedReport = {
  provide: SHARED_REPORT,
  inject: () => [CallerSession] as const,
  useFactory: (session: CallerSession) => ({ session }),
};

describe("a DEFAULT-scoped factory that injects a CONTEXT-scoped provider", () => {
  it("is refused when the provider is a parent registry's", async () => {
    @App({ name: 'Reports', providers: [sharedReport] })
    class ReportsApp {}

    await expect(
      createContainer({ providers: [CallerSession], apps: [ReportsApp], logging: quiet }),
    ).rejects.toBeInstanceOf(InvalidDependencyScopeError);
  });

  it('is refused when it is added to a registry later', async () => {
    const parent = new ProviderRegistry([CallerSession]);
    await parent.ready;
    const child = new ProviderRegistry([], parent);
    await child.ready;

    await expect(child.addDynamicProviders([sharedReport])).rejects.toBeInstanceOf(InvalidDependencyScopeError);
  });
});
