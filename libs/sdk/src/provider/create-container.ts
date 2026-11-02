import { isClass, type Token } from '@frontmcp/di';
import { z } from '@frontmcp/lazy-zod';

import { collectAppMetadata } from '../app/app.utils';
import {
  annotatedFrontMcpAppSchema,
  annotatedFrontMcpProvidersSchema,
  FrontMcpLogger,
  lifecycleOptionsSchema,
  loggingOptionsSchema,
  type AppType,
  type LifecycleOptionsInput,
  type LoggingOptionsInput,
  type ProviderType,
  type RawZodShape,
} from '../common';
import { ProviderNotAvailableError } from '../errors';
import { FrontMcpConfig } from '../front-mcp/front-mcp.tokens';
import LoggerRegistry from '../logger/logger.registry';
import ProviderRegistry from './provider.registry';

export interface CreateContainerOptions {
  /** Server-level providers, as in `@FrontMcp({ providers })`. */
  providers?: ProviderType[];
  /** Apps whose own `@App({ providers })` are built below the server-level ones; remote apps are skipped. */
  apps?: AppType[];
  logging?: LoggingOptionsInput;
  lifecycle?: LifecycleOptionsInput;
}

/** The providers of a server, built without its tools, resources, prompts, flows or transport. */
export interface FrontMcpContainer {
  /** The GLOBAL provider for `token`, server-level first, then each app's in order. */
  get<T>(token: Token<T>): T;
  /** Like `get()`, but `undefined` when nothing registers `token`. */
  tryGet<T>(token: Token<T>): T | undefined;
  /** Run every provider's `onShutdown()`, the apps' first, then release the container. */
  dispose(): Promise<void>;
}

const createContainerOptionsSchema = z.object({
  providers: z.array(annotatedFrontMcpProvidersSchema).optional().default([]),
  apps: z.array(annotatedFrontMcpAppSchema).optional().default([]),
  logging: loggingOptionsSchema.optional(),
  lifecycle: lifecycleOptionsSchema.optional(),
} satisfies RawZodShape<CreateContainerOptions>);

/** Build the providers a server would (same tokens, scopes and `onBootstrap()` order) and nothing else; no `onReady()`. */
export async function createContainer(options: CreateContainerOptions): Promise<FrontMcpContainer> {
  const { providers, apps, logging, lifecycle } = createContainerOptionsSchema.parse(options);
  const root = new ProviderRegistry(
    [{ name: 'frontmcp:config', provide: FrontMcpConfig, useValue: { ...options, logging, lifecycle } }],
    undefined,
    { shutdownHookTimeoutMs: lifecycle?.shutdownHookTimeoutMs },
  );
  await root.ready;
  const loggers = new LoggerRegistry(root);
  await loggers.ready;
  const logger = root.get(FrontMcpLogger);

  const dispose = async (): Promise<void> => {
    await root.runShutdownHooks(logger);
    root.dispose();
  };

  const registries: ProviderRegistry[] = [];
  try {
    const serverProviders = new ProviderRegistry(providers, root);
    registries.push(serverProviders);
    await serverProviders.ready;
    for (const app of apps.filter(isClass)) {
      const appProviders = new ProviderRegistry(collectAppMetadata(app).providers ?? [], serverProviders);
      registries.push(appProviders);
      await appProviders.ready;
    }
  } catch (error) {
    await dispose();
    throw error;
  }

  const get = <T>(token: Token<T>): T => {
    let missing: unknown;
    for (const registry of registries) {
      try {
        return registry.get(token);
      } catch (error) {
        if (!(error instanceof ProviderNotAvailableError)) throw error;
        missing = error;
      }
    }
    throw missing;
  };

  const tryGet = <T>(token: Token<T>): T | undefined => {
    try {
      return get(token);
    } catch (error) {
      if (error instanceof ProviderNotAvailableError) return undefined;
      throw error;
    }
  };

  return { get, tryGet, dispose };
}
