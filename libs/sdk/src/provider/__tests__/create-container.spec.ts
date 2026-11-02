import 'reflect-metadata';

import {
  App,
  FrontMcpLogger,
  LogLevel,
  Provider,
  ProviderScope,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
} from '../../common';
import { ProviderBootstrapError, ProviderNotAvailableError, ProviderScopedAccessError } from '../../errors';
import { createContainer } from '../create-container';

const phases: string[] = [];
const quiet = { level: LogLevel.Off, enableConsole: false };

@Provider({ name: 'settings' })
class Settings implements OnBootstrap, OnReady, OnShutdown {
  readonly region = 'eu';
  onBootstrap() {
    phases.push('bootstrap:settings');
  }
  onReady() {
    phases.push('ready:settings');
  }
  onShutdown() {
    phases.push('shutdown:settings');
  }
}

@Provider({ name: 'ledger' })
class Ledger implements OnBootstrap, OnShutdown {
  constructor(
    readonly settings: Settings,
    readonly logger: FrontMcpLogger,
  ) {}
  async onBootstrap() {
    phases.push('bootstrap:ledger');
  }
  async onShutdown() {
    phases.push('shutdown:ledger');
  }
}

@Provider({ name: 'per-request', scope: ProviderScope.CONTEXT })
class PerRequest {}

@App({ name: 'Billing', providers: [Ledger, PerRequest] })
class BillingApp {}

describe('createContainer', () => {
  beforeEach(() => {
    phases.length = 0;
  });

  it('builds server and app providers with their dependencies, and never readies them', async () => {
    const container = await createContainer({ providers: [Settings], apps: [BillingApp], logging: quiet });

    const ledger = container.get(Ledger);
    expect(ledger.settings).toBe(container.get(Settings));
    expect(ledger.logger).toBe(container.get(FrontMcpLogger));
    expect(phases).toEqual(['bootstrap:settings', 'bootstrap:ledger']);

    await container.dispose();
  });

  it('runs onShutdown in reverse order on dispose(), once', async () => {
    const container = await createContainer({ providers: [Settings], apps: [BillingApp], logging: quiet });

    await container.dispose();
    await container.dispose();

    expect(phases).toEqual(['bootstrap:settings', 'bootstrap:ledger', 'shutdown:ledger', 'shutdown:settings']);
  });

  it('answers undefined from tryGet() and throws from get() for a token nothing registers', async () => {
    const container = await createContainer({ providers: [Settings], logging: quiet });
    const MISSING = Symbol('MISSING');

    expect(container.tryGet(MISSING)).toBeUndefined();
    expect(() => container.get(MISSING)).toThrow(ProviderNotAvailableError);

    await container.dispose();
  });

  it('refuses a CONTEXT-scoped provider, which only a request builds', async () => {
    const container = await createContainer({ apps: [BillingApp], providers: [Settings], logging: quiet });

    expect(() => container.get(PerRequest)).toThrow(ProviderScopedAccessError);
    expect(() => container.tryGet(PerRequest)).toThrow(ProviderScopedAccessError);

    await container.dispose();
  });

  it('accepts a server config, and skips its remote apps and other options', async () => {
    const serverConfig = {
      info: { name: 'billing', version: '1.0.0' },
      providers: [Settings],
      apps: [BillingApp, App.remote('https://crm.example.com/mcp')],
      logging: quiet,
      http: { port: 4000 },
    };

    const container = await createContainer(serverConfig);

    expect(container.get(Ledger).settings.region).toBe('eu');
    await container.dispose();
  });

  it('fails with ProviderBootstrapError and shuts down what bootstrapped', async () => {
    @Provider({ name: 'broken' })
    class Broken implements OnBootstrap {
      onBootstrap() {
        throw new Error('no credentials');
      }
    }
    @App({ name: 'Broken', providers: [Broken] })
    class BrokenApp {}

    const failure = createContainer({ providers: [Settings], apps: [BrokenApp], logging: quiet });

    await expect(failure).rejects.toBeInstanceOf(ProviderBootstrapError);
    expect(phases).toEqual(['bootstrap:settings', 'shutdown:settings']);
  });

  it('gives up on an onShutdown() that outlasts lifecycle.shutdownHookTimeoutMs', async () => {
    @Provider({ name: 'hung' })
    class Hung implements OnShutdown {
      onShutdown() {
        return new Promise<void>(() => undefined);
      }
    }
    const container = await createContainer({
      providers: [Settings, Hung],
      logging: quiet,
      lifecycle: { shutdownHookTimeoutMs: 20 },
    });

    const started = Date.now();
    await container.dispose();

    expect(Date.now() - started).toBeLessThan(1000);
    expect(phases).toEqual(['bootstrap:settings', 'shutdown:settings']);
  });

  it('refuses an invalid lifecycle option', async () => {
    await expect(createContainer({ lifecycle: { shutdownHookTimeoutMs: -1 } })).rejects.toThrow(
      'lifecycle.shutdownHookTimeoutMs must be greater than 0',
    );
  });
});
