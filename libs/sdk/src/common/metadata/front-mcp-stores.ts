/** Where a server config keeps the settings of the stores the server opens. */
const STORE_SETTINGS: ReadonlyArray<readonly [string, string?]> = [
  ['redis'],
  ['pubsub'],
  ['sqlite'],
  ['jobs', 'store'],
  ['tasks', 'redis'],
  ['tasks', 'sqlite'],
  ['transport', 'persistence'],
  ['transport', 'eventStore'],
  ['elicitation', 'redis'],
  ['throttle', 'storage'],
  ['auth', 'tokenStorage'],
  ['auth', 'secureStore'],
];

type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A config without its store settings: a build reads a server without them, since it opens no store. */
export function withoutStores<Config extends object>(config: Config): Config {
  const stripped = { ...config } as ConfigRecord;
  for (const [key, nested] of STORE_SETTINGS) {
    if (nested === undefined) delete stripped[key];
    else if (isRecord(stripped[key])) stripped[key] = { ...stripped[key], [nested]: undefined };
  }
  return stripped as Config;
}

/** `config` with the store settings of `source` put back as `source` gives them, unvalidated. */
export function withStoresOf<Config extends object>(config: Config, source: object): Config {
  const restored = { ...config } as ConfigRecord;
  const given = source as ConfigRecord;
  for (const [key, nested] of STORE_SETTINGS) {
    const parent = given[key];
    if (nested === undefined) {
      if (parent !== undefined) restored[key] = parent;
    } else if (isRecord(parent) && parent[nested] !== undefined && isRecord(restored[key])) {
      restored[key] = { ...restored[key], [nested]: parent[nested] };
    }
  }
  return restored as Config;
}
