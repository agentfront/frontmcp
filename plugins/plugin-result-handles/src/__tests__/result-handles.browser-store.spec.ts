/**
 * A browser has no TCP socket for Redis and no file for SQLite: in a browser, a ResultHandlesPlugin `storage` on either
 * is refused before it opens, with BrowserStoreUnavailableError naming `storage: { type: 'memory' }` (#1033).
 */
import 'reflect-metadata';

import { BrowserStoreUnavailableError } from '@frontmcp/sdk';
import { getRuntimeContext, type RuntimeContext, type StorageConfig } from '@frontmcp/utils';

import { ResultHandlesPlugin } from '../index';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;

const redisStorage: StorageConfig = { type: 'redis', redis: { url: 'redis://127.0.0.1:6379' } };
const sqliteStorage: StorageConfig = { type: 'sqlite', sqlite: { path: '/var/lib/app/results.sqlite' } };

afterEach(() => runtimeContext.mockImplementation(realRuntimeContext));

describe('ResultHandlesPlugin in a browser', () => {
  beforeEach(() => {
    runtimeContext.mockImplementation(() => ({
      ...realRuntimeContext(),
      runtime: 'browser',
      deployment: 'standalone',
    }));
  });

  it.each([
    ["storage: { type: 'redis' }", redisStorage],
    ["storage: { type: 'sqlite' }", sqliteStorage],
  ])('refuses %s, naming the memory storage', (option, storage) => {
    expect(() => ResultHandlesPlugin.init({ storage })).toThrow(BrowserStoreUnavailableError);
    expect(() => ResultHandlesPlugin.init({ storage })).toThrow(
      `ResultHandlesPlugin would use ${option} (set storage: { type: 'memory' } in place of ${option})`,
    );
  });

  it('keeps a memory, an auto-detected or a Vercel KV storage', () => {
    expect(() => ResultHandlesPlugin.init()).not.toThrow();
    expect(() => ResultHandlesPlugin.init({ storage: { type: 'memory' } })).not.toThrow();
    expect(() => ResultHandlesPlugin.init({ storage: { type: 'vercel-kv' } })).not.toThrow();
  });
});

describe('ResultHandlesPlugin on Node', () => {
  it('keeps a Redis or SQLite storage', () => {
    expect(() => ResultHandlesPlugin.init({ storage: redisStorage })).not.toThrow();
    expect(() => ResultHandlesPlugin.init({ storage: sqliteStorage })).not.toThrow();
  });
});
