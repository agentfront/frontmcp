import { type ProviderType, type ToolType } from '../interfaces';

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

/** Tools a plugin derives from its options, from every `static dynamicTools` on the class chain. */
export function collectDynamicTools<T>(klass: any, options: T): ToolType[] {
  const chain: any[] = [];
  for (let k = klass; k && k !== Function.prototype; k = Object.getPrototypeOf(k)) {
    chain.push(k);
  }
  const out: ToolType[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const k = chain[i];
    if (Object.prototype.hasOwnProperty.call(k, 'dynamicTools') && typeof k.dynamicTools === 'function') {
      out.push(...(k.dynamicTools(options) ?? []));
    }
  }
  return out;
}

/** Metadata keys whose value is a list of entries; an option of the same name is not one of them. */
const LIST_METADATA_KEYS = ['exports', 'plugins', 'adapters', 'tools', 'resources', 'prompts', 'skills'] as const;

/**
 * The part of a plugin's options that the registry reads as plugin metadata. A plugin option that
 * shares a name with a list-valued metadata key (RememberPlugin's `tools: { enabled }`) stays an
 * option: it reaches the plugin instance, not the registry. `tools` is the list given under it
 * (if it is one) plus the tools the plugin contributes for its options.
 */
export function pluginMetadataFromOptions<T extends object>(options: T, dynamicTools: readonly ToolType[]): T {
  const out: Record<string, unknown> = { ...(options as Record<string, unknown>) };
  for (const key of LIST_METADATA_KEYS) {
    if (key in out && !Array.isArray(out[key])) delete out[key];
  }
  const tools = [...((out['tools'] as ToolType[] | undefined) ?? []), ...dynamicTools];
  if (tools.length > 0) out['tools'] = tools;
  return out as T;
}

export function dedupePluginProviders(providers: readonly ProviderType[]): ProviderType[] {
  const map = new Map<any, ProviderType>();
  for (const p of providers) map.set(p['provide'] ?? p, p as any); // class-as-token fallback
  return [...map.values()];
}
