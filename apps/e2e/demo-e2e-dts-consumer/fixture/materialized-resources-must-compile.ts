import 'reflect-metadata';

import {
  App,
  FrontMcp,
  MATERIALIZED_META_KEY,
  MaterializedResourceContext,
  Resource,
  ResourceContext,
  resourceStore,
  type ReadResourceResult,
  type ResourceKey,
  type ResourceSnapshot,
  type ResourceStoreOptions,
} from '@frontmcp/sdk';

interface Board {
  open: number;
}

const options: ResourceStoreOptions = {
  storage: { type: 'sqlite', sqlite: { path: '/var/lib/board/state.sqlite' } },
  pollIntervalMs: 500,
  coalesceMs: 25,
  onError: (error: unknown) => console.warn(error),
};
const store = resourceStore(options);
const board: ResourceKey<Board> = store.key<Board>('board', { initial: { open: 0 } });
const motd: ResourceKey<string | undefined> = store.key<string>('motd');

@Resource({ name: 'board', uri: 'board://status', mimeType: 'application/json', from: board })
export class BoardResource extends MaterializedResourceContext {}

@Resource({ name: 'motd', uri: 'board://motd', from: motd })
export class MotdResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    const { value } = await motd.get();
    return { contents: [{ uri, text: value ?? 'nothing today' }] };
  }
}

@App({ name: 'board', resources: [BoardResource, MotdResource] })
class BoardApp {}

@FrontMcp({ info: { name: 'materialized', version: '1.0.0' }, apps: [BoardApp] })
export class MaterializedServer {}

export async function openTicket(): Promise<number> {
  const snapshot: ResourceSnapshot<Board> = await board.update((current) => ({ open: current.open + 1 }));
  const updatedAt: string | undefined = snapshot.updatedAt;
  return updatedAt ? snapshot.revision : 0;
}

export function follow(): () => void {
  const stopTopic = store.subscribe('dashboard', () => void store.publish('dashboard'));
  const stopBoard = board.subscribe((snapshot) => console.log(snapshot.value.open, MATERIALIZED_META_KEY));
  return () => {
    stopTopic();
    stopBoard();
  };
}

// @ts-expect-error a value of the key's type
void board.set({ open: 'many' });

// @ts-expect-error `from` takes a resource store key
@Resource({ name: 'wrong', uri: 'board://wrong', from: 'board' })
export class WrongResource extends MaterializedResourceContext {}

// @ts-expect-error pollIntervalMs is a number
resourceStore({ pollIntervalMs: '250' });

// @ts-expect-error a store writes with compare-and-set, which only memory, Redis and SQLite have
resourceStore({ storage: { type: 'upstash' } });
