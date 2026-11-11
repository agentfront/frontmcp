import { isClass, type Token } from '@frontmcp/di';
import { z } from '@frontmcp/lazy-zod';

import { collectAppMetadata } from '../app/app.utils';
import {
  annotatedFrontMcpAppSchema,
  annotatedFrontMcpProvidersSchema,
  FrontMcpLogger,
  lifecycleOptionsSchema,
  loggingOptionsSchema,
  redisOptionsSchema,
  type AppType,
  type LifecycleOptionsInput,
  type LoggingOptionsInput,
  type ProviderType,
  type RawZodShape,
  type RedisOptionsInput,
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
  /** Start the `@Duty` and `@Worker` providers, as a server does once it serves; `dispose()` stops them. @default false */
  runBackground?: boolean;
  /** The older name of `runBackground`, with the same effect: it starts the `@Worker` providers too. */
  runDuties?: boolean;
  /**
   * The server's name, as in `@FrontMcp({ info })`: duties and workers share their leases with that server's. Needed
   * with `runBackground`.
   */
  info?: { name: string };
  /**
   * The server's Redis, as in `@FrontMcp({ redis })`: duties and workers keep their leases there, and
   * `scope: 'cluster'` needs it.
   */
  redis?: RedisOptionsInput;
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

const createContainerOptionsSchema = z
  .object({
    providers: z.array(annotatedFrontMcpProvidersSchema).optional().default([]),
    apps: z.array(annotatedFrontMcpAppSchema).optional().default([]),
    logging: loggingOptionsSchema.optional(),
    lifecycle: lifecycleOptionsSchema.optional(),
    runBackground: z.boolean({ message: 'runBackground must be true or false' }).optional(),
    runDuties: z.boolean({ message: 'runDuties must be true or false' }).optional(),
    info: z.object({ name: z.string().min(1, 'info.name must not be empty') }).optional(),
    redis: redisOptionsSchema.optional(),
  } satisfies RawZodShape<CreateContainerOptions>)
  .superRefine(({ runBackground, runDuties, info }, context) => {
    const asked = runBackground ? 'runBackground' : runDuties ? 'runDuties' : undefined;
    if (asked === undefined || info !== undefined) return;
    const message = `${asked} needs info.name: duties and workers share their leases by server name`;
    context.addIssue({ code: 'custom', path: ['info'], message });
  });

/**
 * Build the providers a server would (same tokens, scopes and `onBootstrap()` order) and nothing else; no `onReady()`,
 * and no duty or worker runs unless `runBackground` asks.
 */
export async function createContainer(options: CreateContainerOptions): Promise<FrontMcpContainer> {
  const { providers, apps, logging, lifecycle, ...parsed } = createContainerOptionsSchema.parse(options);
  const runBackground = parsed.runBackground === true || parsed.runDuties === true;
  const config = { ...options, logging, lifecycle, runBackground };
  const root = new ProviderRegistry(
    [{ name: 'frontmcp:config', provide: FrontMcpConfig, useValue: config }],
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
    if (runBackground) {
      const { startDuties } = await import('../duty/duty.lifecycle.js');
      const { startWorkers } = await import('../worker/worker.lifecycle.js');
      for (const registry of registries) {
        await startDuties(registry);
        await startWorkers(registry);
      }
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
