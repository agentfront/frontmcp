/**
 * A browser has no file for SQLite: sqliteStorageProvider() is refused at boot, before it opens the file, with
 * BrowserStoreUnavailableError (the provider's construction error wraps it) naming a memory storage in its place.
 */
import 'reflect-metadata';

import { createStorage, getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import { LogLevel } from '../../common';
import { BrowserStoreUnavailableError, ProviderConstructionError } from '../../errors';
import { createContainer } from '../../provider/create-container';
import { sqliteStorageProvider } from '../sqlite-storage.provider';

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

afterEach(() => runtimeContext.mockImplementation(realRuntimeContext));

describe('sqliteStorageProvider in a browser', () => {
  it('refuses the SQLite file at boot', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    runtimeContext.mockImplementation(() => ({
      ...realRuntimeContext(),
      runtime: 'browser',
      deployment: 'standalone',
    }));

    const boot = createContainer({
      providers: [sqliteStorageProvider({ path: '/var/lib/app/state.sqlite' })],
      logging: { level: LogLevel.Off, enableConsole: false },
    });

    const failure = await boot.catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderConstructionError);
    const refusal = (failure as ProviderConstructionError).originalError;
    expect(refusal).toBeInstanceOf(BrowserStoreUnavailableError);
    expect(refusal).toMatchObject({
      stores: [['sqliteStorage', 'sqliteStorageProvider()']],
      message:
        'A browser cannot open Redis or SQLite: a storage provider would use sqliteStorageProvider() ' +
        '(set a provider of createMemoryStorage() in place of sqliteStorageProvider())',
    });
    expect(createStorage).not.toHaveBeenCalled();
  });
});
