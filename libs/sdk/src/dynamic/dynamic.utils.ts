import { ProviderType } from '@frontmcp/sdk';

export function collectDynamicProviders<T>(klass: any, options: T): ProviderType[] {
  // walk the prototype chain so parent plugins can contribute
  const chain: any[] = [];
  for (let k = klass; k && k !== Function.prototype; k = Object.getPrototypeOf(k)) {
    chain.push(k);
  }
  // parent-first; child can override tokens later
  const out: ProviderType[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const k = chain[i];
    if (typeof k.dynamicProviders === 'function') {
      out.push(...(k.dynamicProviders(options) ?? []));
    }
  }
  return out;
}

export function dedupePluginProviders(providers: readonly ProviderType[]): ProviderType[] {
  const map = new Map<any, ProviderType>();
  for (const p of providers) map.set(p['provide'] ?? p, p as any); // class-as-token fallback
  return [...map.values()];
}
