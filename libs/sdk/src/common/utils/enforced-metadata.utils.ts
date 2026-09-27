/**
 * Entry metadata that only a plugin enforces, such as `approval` or `featureFlag`.
 *
 * The SDK itself does nothing with these fields: a plugin's hooks read them and gate the entry. An
 * entry that declares one is protected only when a plugin that enforces it reaches the entry, so
 * the server refuses to start otherwise (`findUnenforcedMetadata`, run by every scope at startup).
 *
 * A plugin declares the keys it enforces with `@Plugin({ enforcesMetadata: [...] })`, and defining
 * such a plugin class registers them here. The keys of FrontMCP's own plugins are known without
 * loading them, because the failure this guards against is the plugin never being loaded:
 * TypeScript accepts `approval: true` as soon as the plugin's types are in the program, and drops
 * an import of the plugin that nothing uses, so no plugin module would be there to register it.
 */
const enforcedMetadataKeys = new Map<string, string>([
  ['approval', 'ApprovalPlugin from @frontmcp/plugin-approval'],
  ['featureFlag', 'FeatureFlagPlugin from @frontmcp/plugin-feature-flags'],
]);

/**
 * Record metadata keys a plugin enforces. The first registration of a key keeps its description.
 *
 * @param keys - metadata keys the plugin's hooks enforce
 * @param enforcedBy - who enforces them, for startup errors (e.g. `plugin "approval"`)
 */
export function registerEnforcedMetadataKeys(keys: readonly string[], enforcedBy: string): void {
  for (const key of keys) {
    if (!enforcedMetadataKeys.has(key)) enforcedMetadataKeys.set(key, enforcedBy);
  }
}

/** Every metadata key known to be enforced by a plugin. */
export function getEnforcedMetadataKeys(): string[] {
  return [...enforcedMetadataKeys.keys()];
}

/** Who enforces a metadata key, for startup errors; `undefined` for a key no plugin declared. */
export function describeMetadataEnforcer(key: string): string | undefined {
  return enforcedMetadataKeys.get(key);
}

/**
 * Whether an entry's value for such a key asks for enforcement. `undefined`, `null` and `false`
 * (e.g. `approval: false`) ask for nothing.
 */
export function isEnforcementRequested(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}
