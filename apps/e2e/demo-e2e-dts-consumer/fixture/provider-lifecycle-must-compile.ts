import 'reflect-metadata';

import {
  App,
  createContainer,
  FrontMcp,
  Provider,
  ProviderBootstrapError,
  type CreateContainerOptions,
  type FrontMcpContainer,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
} from '@frontmcp/sdk';

@Provider({ name: 'pool' })
export class Pool implements OnBootstrap, OnReady, OnShutdown {
  async onBootstrap(): Promise<void> {
    return;
  }
  onReady(): void {
    return;
  }
  async onShutdown(): Promise<void> {
    return;
  }
}

@App({ name: 'billing', providers: [Pool] })
class BillingApp {}

@FrontMcp({
  info: { name: 'lifecycle', version: '1.0.0' },
  apps: [BillingApp],
  lifecycle: { shutdownHookTimeoutMs: 10_000 },
})
export class LifecycleServer {}

@FrontMcp({
  info: { name: 'lifecycle-typo', version: '1.0.0' },
  apps: [BillingApp],
  // @ts-expect-error shutdownHookTimeoutMs is a number of milliseconds
  lifecycle: { shutdownHookTimeoutMs: '10s' },
})
export class LifecycleTypoServer {}

const options: CreateContainerOptions = {
  providers: [Pool],
  apps: [BillingApp],
  lifecycle: { shutdownHookTimeoutMs: 500 },
};

export async function readPool(): Promise<Pool | undefined> {
  const container: FrontMcpContainer | undefined = await createContainer(options).catch((error: unknown) => {
    if (error instanceof ProviderBootstrapError) return undefined;
    throw error;
  });
  if (!container) return undefined;
  try {
    const pool: Pool = container.get(Pool);
    return container.tryGet(Pool) ?? pool;
  } finally {
    await container.dispose();
  }
}
