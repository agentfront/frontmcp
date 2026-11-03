/**
 * A browser has no TCP socket for Redis and no file for SQLite: in a browser, an ApprovalPlugin `storage` on either is
 * refused before it opens, with BrowserStoreUnavailableError naming `storage: { type: 'memory' }` (#1033).
 */
import 'reflect-metadata';

import { BrowserStoreUnavailableError } from '@frontmcp/sdk';
import { createMemoryStorage, getRuntimeContext, type RuntimeContext, type StorageConfig } from '@frontmcp/utils';

import { ApprovalPlugin } from '../index';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;

const redisStorage: StorageConfig = { type: 'redis', redis: { url: 'redis://127.0.0.1:6379' } };
const sqliteStorage: StorageConfig = { type: 'sqlite', sqlite: { path: '/var/lib/app/approvals.sqlite' } };

afterEach(() => runtimeContext.mockImplementation(realRuntimeContext));

describe('ApprovalPlugin in a browser', () => {
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
    expect(() => ApprovalPlugin.init({ storage })).toThrow(BrowserStoreUnavailableError);
    expect(() => ApprovalPlugin.init({ storage })).toThrow(
      `ApprovalPlugin would use ${option} (set storage: { type: 'memory' } in place of ${option})`,
    );
  });

  it('keeps a memory, an auto-detected or a Vercel KV storage, and a storage instance given in place of storage', () => {
    expect(() => ApprovalPlugin.init()).not.toThrow();
    expect(() => ApprovalPlugin.init({ storage: redisStorage, storageInstance: createMemoryStorage() })).not.toThrow();
    expect(() => ApprovalPlugin.init({ storage: { type: 'memory' } })).not.toThrow();
    expect(() => ApprovalPlugin.init({ storage: { type: 'vercel-kv' } })).not.toThrow();
  });
});

describe('ApprovalPlugin on Node', () => {
  it('keeps a Redis or SQLite storage', () => {
    expect(() => ApprovalPlugin.init({ storage: redisStorage })).not.toThrow();
    expect(() => ApprovalPlugin.init({ storage: sqliteStorage })).not.toThrow();
  });
});
