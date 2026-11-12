import { MemoryStorageAdapter } from '@frontmcp/utils';

import { createSqliteSessionStore } from '../../auth/session/session-store.factory';
import { createSqliteElicitationStore } from '../../elicitation/store/elicitation-store.factory';
import { createEventSubscriptionStore } from '../../event/subscription/event-subscription-store.factory';
import { createTaskStore } from '../../task/store/task-store.factory';
import { createEventStore } from '../../transport/event-stores/event-store.factory';
import { registerOptionalModule } from '../optional-dependency.util';

jest.mock('@frontmcp/storage-sqlite', () => {
  throw new Error('@frontmcp/storage-sqlite was required');
});

const SQLITE_STORAGE = '@frontmcp/storage-sqlite';
const REGISTRY = Symbol.for('frontmcp.bundledOptionalModules');
const PATH = 'bundled.sqlite';

/** What a Worker's bundle registers: the package's classes, here recording what they are constructed with. */
function bundledSqliteStorage() {
  return {
    SqliteSessionStore: jest.fn(),
    SqliteElicitationStore: jest.fn(),
    SqliteTaskStore: jest.fn(),
    SqliteEventStore: jest.fn(),
    SqliteStorageAdapter: jest.fn(() => new MemoryStorageAdapter()),
  };
}

describe('@frontmcp/storage-sqlite registered with registerOptionalModule()', () => {
  let bundled: ReturnType<typeof bundledSqliteStorage>;

  beforeEach(() => {
    bundled = bundledSqliteStorage();
    registerOptionalModule(SQLITE_STORAGE, bundled);
  });

  afterEach(() => {
    (globalThis as unknown as Record<symbol, Map<string, unknown>>)[REGISTRY].delete(SQLITE_STORAGE);
  });

  it.each([
    ['the session store', 'SqliteSessionStore', () => createSqliteSessionStore({ path: PATH })],
    ['the elicitation store', 'SqliteElicitationStore', () => createSqliteElicitationStore({ path: PATH })],
    ['the task store', 'SqliteTaskStore', () => createTaskStore({ sqlite: { path: PATH } })],
    [
      'the stream event store',
      'SqliteEventStore',
      () => createEventStore({ enabled: true, provider: 'sqlite', sqlite: { path: PATH } }),
    ],
    [
      'the Events subscription store',
      'SqliteStorageAdapter',
      () => createEventSubscriptionStore({ sqlite: { path: PATH }, secret: 'a-secret-for-specs' }),
    ],
  ] as const)(
    'builds %s from the registered module, without requiring the package',
    async (_store, className, create) => {
      await create();

      expect(bundled[className]).toHaveBeenCalledWith(expect.objectContaining({ path: PATH }));
    },
  );

  it('requires the package when it is not registered', () => {
    (globalThis as unknown as Record<symbol, Map<string, unknown>>)[REGISTRY].delete(SQLITE_STORAGE);

    expect(() => createSqliteSessionStore({ path: PATH })).toThrow('@frontmcp/storage-sqlite was required');
  });
});
