import { type AdapterInterface, type ProviderType, type ToolType } from '../interfaces';

/**
 * Whether a value is an adapter the registry can start: an object with `options.name` and
 * `fetch()`. Checked by shape rather than `instanceof`, so an adapter built from another copy of
 * its class (a second bundle of the same package) is still recognised as one.
 */
export function isAdapterInstance(value: unknown): value is AdapterInterface {
  if (!value || typeof value !== 'object') return false;
  const { options, fetch } = value as Partial<AdapterInterface>;
  return !!options && typeof options === 'object' && typeof options.name === 'string' && typeof fetch === 'function';
}

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

/**
 * The plugin metadata `init(options)` may set: lists of entries the plugin installs. `providers` is
 * not listed: `init` always sets it on the record to the providers it collects.
 */
const LIST_METADATA_KEYS = [
  'exports',
  'plugins',
  'adapters',
  'tools',
  'resources',
  'prompts',
  'skills',
  'contextExtensions',
  'enforcesMetadata',
] as const;

/**
 * The part of a plugin's options that the registry reads as plugin metadata: only the list-valued
 * keys above, when the option under that name is a list. Every other option (`name`, `id`,
 * `description`, `scope`, RememberPlugin's `tools: { enabled }`) stays the plugin's own and reaches
 * the plugin instance, never the registry, so options cannot rename a plugin or change its install
 * scope (#707). `tools` is the list given under it plus the tools the plugin contributes.
 */
export function pluginMetadataFromOptions(options: object, dynamicTools: readonly ToolType[]): Record<string, unknown> {
  const optionValues = options as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const key of LIST_METADATA_KEYS) {
    if (Array.isArray(optionValues[key])) metadata[key] = optionValues[key];
  }
  const tools = [...((metadata['tools'] as ToolType[] | undefined) ?? []), ...dynamicTools];
  if (tools.length > 0) metadata['tools'] = tools;
  return metadata;
}

export function dedupePluginProviders(providers: readonly ProviderType[]): ProviderType[] {
  const map = new Map<any, ProviderType>();
  for (const p of providers) map.set(p['provide'] ?? p, p as any); // class-as-token fallback
  return [...map.values()];
}
