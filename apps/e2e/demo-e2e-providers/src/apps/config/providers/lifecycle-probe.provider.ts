import { AsyncProvider, type OnBootstrap, type OnReady, type OnShutdown } from '@frontmcp/sdk';

import { LifecycleJournal } from '../../../providers/lifecycle-journal.provider';

export const LIFECYCLE_PROBE_TOKEN = Symbol('LIFECYCLE_PROBE');

class LifecycleProbe implements OnBootstrap, OnReady, OnShutdown {
  constructor(private readonly journal: LifecycleJournal) {}

  onBootstrap(): Promise<void> {
    return this.journal.record('bootstrap:probe');
  }

  onReady(): Promise<void> {
    return this.journal.record('ready:probe');
  }

  onShutdown(): Promise<void> {
    return this.journal.record('shutdown:probe');
  }
}

/** An app-level factory provider that depends on the server-level journal. */
export const lifecycleProbeProvider = AsyncProvider({
  provide: LIFECYCLE_PROBE_TOKEN,
  name: 'LifecycleProbe',
  inject: () => [LifecycleJournal] as const,
  useFactory: async (journal) => new LifecycleProbe(journal),
});
