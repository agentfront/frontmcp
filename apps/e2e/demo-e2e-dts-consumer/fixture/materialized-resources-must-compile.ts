import 'reflect-metadata';

import {
  App,
  FrontMcp,
  MATERIALIZED_META_KEY,
  MaterializedResourceContext,
  Resource,
  ResourceContext,
  resourceStore,
  ResourceTemplate,
  type ProducedResourceKey,
  type ReadResourceResult,
  type ResourceKey,
  type ResourceKeyFamily,
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

const summary: ProducedResourceKey<{ open: number }> = store.key('summary', {
  produce: async () => ({ open: (await board.get()).value.open }),
  minIntervalMs: 100,
  costFactor: 2,
});
summary.markDirty();

const columns: ResourceKeyFamily<string[]> = store.family<string[]>('columns', { initial: [] });
const columnSizes = store.family('column-sizes', {
  produce: async ({ column }) => (await columns.key({ column }).get()).value.length,
});
columnSizes.key({ column: 'todo' }).markDirty();

@Resource({ name: 'summary', uri: 'board://summary', from: summary })
export class SummaryResource extends MaterializedResourceContext {}

@ResourceTemplate({ name: 'column', uriTemplate: 'board://columns/{column}', from: columns })
export class ColumnResource extends MaterializedResourceContext {}

@ResourceTemplate({ name: 'column-size', uriTemplate: 'board://sizes/{column}', from: columnSizes })
export class ColumnSizeResource extends MaterializedResourceContext {}

@App({ name: 'board', resources: [BoardResource, MotdResource, SummaryResource, ColumnResource, ColumnSizeResource] })
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

// @ts-expect-error `from` on a template takes a key family, not one key
@ResourceTemplate({ name: 'wrong-column', uriTemplate: 'board://wrong/{column}', from: board })
export class WrongColumnResource extends MaterializedResourceContext {}

// @ts-expect-error only a producer-backed key can be marked dirty
board.markDirty();

// @ts-expect-error produce is a function
store.key('broken', { produce: 1 });
