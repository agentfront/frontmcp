// Cloud provider loader — SDK-owned glue that resolves a cloud integration
// package, calls its `contribute()` hook to merge static injections into the
// server metadata, and later runs its async `bootstrap()` after scope-ready.

import type { CloudContributions, CloudProvider } from '../common/types/options/cloud/provider';

/**
 * Resolver that returns the cloud integration module. Parameterized for tests.
 */
export type CloudProviderResolver = () => unknown;

/**
 * Known cloud integrations. Today only Frontegg exists; adding another cloud
 * is a one-line registration here. The SDK picks the right package based on
 * options (or the presence of an opaque `__provider` discriminator if we
 * ever need to support multiple cloud packages installed side-by-side).
 */
const KNOWN_PROVIDERS: Record<string, string> = {
  default: '@frontmcp/plugin-frontegg',
};

/**
 * Lazy-resolve the cloud provider module. Mirrors the observability
 * auto-load pattern — the require is wrapped in try/catch so esbuild
 * treats it as optional at bundle time.
 */
export const defaultCloudResolver: CloudProviderResolver = () => {
  /* eslint-disable no-useless-catch */
  try {
    return require(KNOWN_PROVIDERS['default']);
  } catch (e) {
    throw e;
  }
  /* eslint-enable no-useless-catch */
};

export interface LoadCloudProviderResult {
  provider: CloudProvider;
  contributions: CloudContributions | undefined;
}

/**
 * Resolve the cloud provider module and run its synchronous `contribute()`
 * hook, returning both the provider (for later `bootstrap()` call) and the
 * contributions to merge into metadata.
 *
 * Returns `undefined` when:
 * - `cloud` is not set or is empty
 * - the provider package isn't installed
 * - the resolved module doesn't export `cloudProvider`
 *
 * All failure modes log a warning; none throw.
 */
export function loadCloudProvider(
  cloud: unknown,
  logger: {
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    verbose?: (msg: string, meta?: Record<string, unknown>) => void;
  },
  resolver: CloudProviderResolver = defaultCloudResolver,
): LoadCloudProviderResult | undefined {
  if (!cloud || typeof cloud !== 'object' || Object.keys(cloud as Record<string, unknown>).length === 0) {
    return undefined;
  }

  let mod: unknown;
  try {
    mod = resolver();
  } catch {
    logger.warn(
      'cloud config is set but the cloud provider package is not installed. ' +
        `Install it with: npm install ${KNOWN_PROVIDERS['default']}`,
    );
    return undefined;
  }

  const provider = extractProvider(mod);
  if (!provider) {
    logger.warn('cloud: resolved module does not export `cloudProvider`');
    return undefined;
  }

  let contributions: CloudContributions | undefined;
  try {
    contributions = provider.contribute(cloud as Parameters<CloudProvider['contribute']>[0]);
    logger.verbose?.(`cloud: loaded provider '${provider.name}'`, {
      plugins: contributions?.plugins?.length ?? 0,
      adapters: contributions?.adapters?.length ?? 0,
      providers: contributions?.providers?.length ?? 0,
      tools: contributions?.tools?.length ?? 0,
      overrides: Object.keys(contributions?.optionsOverride ?? {}).length,
    });
  } catch (e) {
    logger.warn(`cloud: provider '${provider.name}' contribute() failed`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return { provider, contributions: undefined };
  }

  return { provider, contributions };
}

function extractProvider(mod: unknown): CloudProvider | undefined {
  if (!mod || typeof mod !== 'object') return undefined;
  const modRec = mod as Record<string, unknown>;
  const candidate = modRec['cloudProvider'];
  if (!isCloudProvider(candidate)) return undefined;
  return candidate;
}

function isCloudProvider(v: unknown): v is CloudProvider {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as CloudProvider).name === 'string' &&
    typeof (v as CloudProvider).contribute === 'function'
  );
}
