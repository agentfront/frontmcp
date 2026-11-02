/**
 * Stdio entrypoint with a provider that keeps a timer running, as a connection pool would, until `onShutdown()`
 * clears it and writes `SHUTDOWN_MARKER`. Only the shutdown phase lets the process end.
 */
import { App, FrontMcpInstance, Provider, type OnReady, type OnShutdown } from '@frontmcp/sdk';
import { writeFile } from '@frontmcp/utils';

import { serverConfig } from './config.js';

@Provider({ name: 'KeepAlive' })
class KeepAlive implements OnReady, OnShutdown {
  private timer?: ReturnType<typeof setInterval>;

  onReady(): void {
    this.timer = setInterval(() => undefined, 60_000);
  }

  async onShutdown(): Promise<void> {
    clearInterval(this.timer);
    const markerPath = process.env['SHUTDOWN_MARKER'];
    if (markerPath) await writeFile(markerPath, 'shutdown');
  }
}

@App({ name: 'Orphan', providers: [KeepAlive] })
class OrphanApp {}

FrontMcpInstance.runStdio({ ...serverConfig, apps: [...serverConfig.apps, OrphanApp] }).catch((err) => {
  console.error('Failed to start stdio server:', err);
  process.exit(1);
});
