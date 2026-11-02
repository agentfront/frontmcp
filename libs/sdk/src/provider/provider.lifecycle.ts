import { tokenName, type Token } from '@frontmcp/di';

import type { FrontMcpLogger, OnBootstrap, OnReady, OnShutdown } from '../common';
import { ProviderBootstrapError } from '../errors';

export const DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS = 3_000;

export type LifecycleLogger = Pick<FrontMcpLogger, 'warn' | 'error'>;

type LifecycleHooks = Partial<OnBootstrap & OnReady & OnShutdown>;

export interface LifecycleEntry {
  token: Token;
  instance: LifecycleHooks;
}

const HOOK_NAMES = ['onBootstrap', 'onReady', 'onShutdown'] as const;

/** The instance, when it declares at least one lifecycle hook. */
export function lifecycleHooksOf(value: unknown): LifecycleHooks | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  return HOOK_NAMES.some((name) => typeof candidate[name] === 'function') ? (value as LifecycleHooks) : undefined;
}

export async function bootstrapProvider({ token, instance }: LifecycleEntry): Promise<void> {
  try {
    await instance.onBootstrap?.();
  } catch (error) {
    throw new ProviderBootstrapError(tokenName(token), error);
  }
}

export async function readyProviders(entries: readonly LifecycleEntry[], logger: LifecycleLogger): Promise<void> {
  for (const { token, instance } of entries) {
    try {
      await instance.onReady?.();
    } catch (error) {
      logger.error(`Provider "${tokenName(token)}" failed in onReady(): ${messageOf(error)}`);
    }
  }
}

export async function shutdownProviders(
  entries: readonly LifecycleEntry[],
  timeoutMs: number,
  logger: LifecycleLogger,
): Promise<void> {
  for (const { token, instance } of [...entries].reverse()) {
    const onShutdown = instance.onShutdown;
    if (typeof onShutdown !== 'function') continue;
    try {
      if (await outlasts(() => onShutdown.call(instance), timeoutMs)) {
        logger.warn(`Provider "${tokenName(token)}" onShutdown() did not finish within ${timeoutMs} ms`);
      }
    } catch (error) {
      logger.warn(`Provider "${tokenName(token)}" failed in onShutdown(): ${messageOf(error)}`);
    }
  }
}

async function outlasts(run: () => unknown, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
  });
  try {
    const finished = Promise.resolve()
      .then(run)
      .then(() => false);
    return await Promise.race([finished, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
