import 'reflect-metadata';

import {
  App,
  AsyncProvider,
  FrontMcp,
  FrontMcpInstance,
  Provider,
  ProviderScope,
  type FrontMcpConfigInput,
  type ProviderType,
  type Token,
} from '@frontmcp/sdk';

interface Settings {
  region: string;
}

interface Store {
  read(key: string): string | undefined;
}

const SETTINGS: Token<Settings> = Symbol('Settings');
const STORE: Token<Store> = Symbol('Store');
const GREETING: Token<string> = 'greeting';

@Provider()
class Clock {
  now(): number {
    return Date.now();
  }
}

@Provider({ scope: ProviderScope.CONTEXT })
class RequestCounter {
  count = 0;
}

const settingsValue = { provide: SETTINGS, useValue: { region: 'eu' } };

const greetingValue = { provide: GREETING, useValue: 'hello', name: 'greeting' };

const storeWithInject = AsyncProvider({
  provide: STORE,
  inject: () => [Clock] as const,
  useFactory: async (clock: Clock): Promise<Store> => ({ read: (key) => `${clock.now()}:${key}` }),
});

const storeWithoutInject = AsyncProvider({
  provide: STORE,
  useFactory: (): Store => ({ read: () => undefined }),
});

const providers: ProviderType[] = [Clock, RequestCounter, settingsValue, greetingValue, storeWithInject];

@App({ name: 'providers', providers: [settingsValue, storeWithInject, storeWithoutInject, Clock] })
class ProvidersApp {}

@FrontMcp({
  info: { name: 'providers', version: '1.0.0' },
  apps: [ProvidersApp],
  providers: [settingsValue, greetingValue, storeWithInject, storeWithoutInject, RequestCounter],
})
export class ProvidersServer {}

const config: FrontMcpConfigInput = {
  info: { name: 'providers', version: '1.0.0' },
  apps: [ProvidersApp],
  providers,
};

export async function startEveryWay(): Promise<void> {
  await FrontMcpInstance.runStdio({ ...config, providers: [storeWithoutInject, settingsValue] });
  await FrontMcpInstance.bootstrap({ ...config, providers: [storeWithInject, settingsValue] });
  const direct = await FrontMcpInstance.createDirect({ ...config, providers: [storeWithInject, greetingValue] });
  await direct.dispose();
  const socket = await FrontMcpInstance.runUnixSocket({ ...config, socketPath: '/tmp/providers.sock' });
  await socket.close();
}
