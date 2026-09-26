import { type ScopeEntry } from '../common';

/** Loads the capabilities of every remote app, including apps of parent scopes, and returns how many there are. */
export async function loadRemoteAppCapabilities(
  scope: ScopeEntry,
  onError: (appId: string, error: Error) => void = () => undefined,
): Promise<number> {
  const remoteApps = scope.providers
    .getRegistries('AppRegistry')
    .flatMap((appRegistry) => appRegistry.getApps())
    .filter((app) => app.isRemote);
  await Promise.all(
    remoteApps.map(async (app) => {
      if (!('ensureCapabilitiesLoaded' in app) || typeof app.ensureCapabilitiesLoaded !== 'function') return;
      try {
        await app.ensureCapabilitiesLoaded();
      } catch (error) {
        onError(app.id, error as Error);
      }
    }),
  );
  return remoteApps.length;
}
