import { ProviderScope, tokenName, type Token } from '@frontmcp/di';

import type { ProviderType } from '../common';
import { normalizeProvider } from './provider.utils';

/**
 * `list`, with each provider whose token the container built replaced by the container's instance; with `addOthers`,
 * the container's other instances are added after them, so a server sees every provider of its container.
 */
export function borrowProviders(
  list: readonly ProviderType[],
  built: ReadonlyMap<Token, unknown> | undefined,
  addOthers: boolean,
): ProviderType[] {
  if (!built || built.size === 0) return [...list];
  const borrowed = (token: Token, name: string): ProviderType => ({
    name,
    provide: token,
    scope: ProviderScope.GLOBAL,
    useValue: built.get(token),
  });
  const listed = new Set<Token>();
  const providers = list.map((item) => {
    const { provide, metadata } = normalizeProvider(item);
    listed.add(provide);
    return built.has(provide) ? borrowed(provide, metadata?.name ?? tokenName(provide)) : item;
  });
  if (!addOthers) return providers;
  for (const token of built.keys()) {
    if (!listed.has(token)) providers.push(borrowed(token, tokenName(token)));
  }
  return providers;
}
