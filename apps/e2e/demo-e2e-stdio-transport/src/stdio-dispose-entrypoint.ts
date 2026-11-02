/**
 * Stdio entrypoint whose scope writes `DISPOSE_MARKER` from an `onDispose` callback, registered from a
 * factory provider as the catalog shows.
 */
import { App, FrontMcpInstance, ScopeEntry } from '@frontmcp/sdk';
import { writeFile } from '@frontmcp/utils';

import { serverConfig } from './config.js';

class DisposeMarker {}

const disposeMarkerProvider = {
  name: 'DisposeMarker',
  provide: DisposeMarker,
  inject: () => [ScopeEntry] as const,
  useFactory: (scope: ScopeEntry) => {
    const markerPath = process.env['DISPOSE_MARKER'];
    if (markerPath) scope.onDispose(() => writeFile(markerPath, 'disposed'));
    return new DisposeMarker();
  },
};

@App({ name: 'Dispose', providers: [disposeMarkerProvider] })
class DisposeApp {}

FrontMcpInstance.runStdio({ ...serverConfig, apps: [...serverConfig.apps, DisposeApp] }).catch((err) => {
  console.error('Failed to start stdio server:', err);
  process.exit(1);
});
