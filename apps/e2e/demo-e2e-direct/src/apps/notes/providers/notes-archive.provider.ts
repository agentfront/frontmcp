import { AsyncProvider, type OnBootstrap, type OnShutdown } from '@frontmcp/sdk';

export class NotesArchive implements OnBootstrap, OnShutdown {
  state: 'created' | 'open' | 'closed' = 'created';

  onBootstrap(): void {
    this.state = 'open';
  }

  onShutdown(): void {
    this.state = 'closed';
  }
}

export const notesArchiveProvider = AsyncProvider({
  provide: NotesArchive,
  name: 'NotesArchive',
  useFactory: async () => new NotesArchive(),
});
