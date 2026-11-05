import { AuthProvidersNotConfiguredError, type AuthProvidersAccessor } from '@frontmcp/auth';

function notConfigured(providerName: string | undefined): never {
  throw new AuthProvidersNotConfiguredError(providerName);
}

/** `this.authProviders` on a server that registers no auth providers: a credential read names the provider it asked for. */
export const unconfiguredAuthProviders: AuthProvidersAccessor = {
  get: async (providerName) => notConfigured(providerName),
  getMany: async (providerNames) => notConfigured(providerNames[0]),
  headers: async (providerName) => notConfigured(providerName),
  headersMany: async (providerNames) => notConfigured(providerNames[0]),
  refresh: async (providerName) => notConfigured(providerName),
  has: async () => false,
  isRegistered: () => false,
  invalidate: () => undefined,
  invalidateAll: () => undefined,
  listProviders: () => [],
  listAvailable: async () => [],
};
