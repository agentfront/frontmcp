/**
 * A browser has no TCP socket for Redis and no file for SQLite: a resource store on either is refused before it opens,
 * with BrowserStoreUnavailableError naming `storage: { type: 'memory' }`. A memory store opens as on Node.
 */
import { createStorage, getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import { BrowserStoreUnavailableError } from '../../../errors';
import { resourceStore } from '../resource-store';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    getRuntimeContext: jest.fn(actual.getRuntimeContext),
    createStorage: jest.fn(actual.createStorage),
  };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;
const storageFactory = createStorage as jest.MockedFunction<typeof createStorage>;

beforeEach(() => {
  runtimeContext.mockImplementation(() => ({ ...realRuntimeContext(), runtime: 'browser', deployment: 'standalone' }));
});

afterEach(() => {
  runtimeContext.mockImplementation(realRuntimeContext);
  jest.clearAllMocks();
});

describe('a resource store in a browser', () => {
  it.each([
    ['redis', { type: 'redis' as const, redis: { url: 'redis://127.0.0.1:6379' } }],
    ['sqlite', { type: 'sqlite' as const, sqlite: { path: '/var/lib/app/resources.sqlite' } }],
  ])('refuses a %s storage before it opens', async (type, storage) => {
    const opening = resourceStore({ storage }).connect();

    await expect(opening).rejects.toBeInstanceOf(BrowserStoreUnavailableError);
    await expect(opening).rejects.toMatchObject({
      stores: [['resourceStore', `storage: { type: '${type}' }`]],
      message:
        `A browser cannot open Redis or SQLite: a resource store would use storage: { type: '${type}' } ` +
        `(set storage: { type: 'memory' } in place of storage: { type: '${type}' })`,
    });
    expect(storageFactory).not.toHaveBeenCalled();
  });

  it('opens a memory store', async () => {
    const store = resourceStore();
    const board = store.key('board', { initial: 0 });

    await board.set(1);
    expect((await board.get()).value).toBe(1);
    await store.close();
  });
});
