import * as os from 'os';
import * as path from 'path';

import { resetRuntimeContext, sha256Hex } from '@frontmcp/utils';

import { redisOptionsSchema, type FrontMcpConfigType } from '../../common';
import { findProjectRoot } from '../../common/types/options/sqlite/resolve';
import { markManifestMode } from '../../front-mcp/manifest-mode.flag';
import { isLongLivedProcess, LeaseClaims, leaseKey, leaseStorageConfig, startsBackgroundWork } from '../lease-store';

jest.mock('../../common/types/options/sqlite/resolve', () => {
  const actual = jest.requireActual('../../common/types/options/sqlite/resolve');
  return { ...actual, findProjectRoot: jest.fn(actual.findProjectRoot) };
});

class InboxWatcher {}
class OtherWatcher {}

function configOf(extra: Record<string, unknown> = {}): FrontMcpConfigType {
  return { info: { name: 'lease-spec', version: '1.0.0' }, ...extra } as unknown as FrontMcpConfigType;
}

describe('leaseStorageConfig', () => {
  const redis = redisOptionsSchema.parse({ url: 'redis://cache.internal:6379' });

  it.each([
    ['duty', 'machine', `frontmcp:duty:${os.hostname()}:`],
    ['duty', 'workspace', `frontmcp:duty:${os.hostname()}:`],
    ['duty', 'cluster', 'frontmcp:cluster:duty:'],
    ['worker', 'machine', `frontmcp:worker:${os.hostname()}:`],
    ['worker', 'workspace', `frontmcp:worker:${os.hostname()}:`],
    ['worker', 'cluster', 'frontmcp:cluster:worker:'],
  ] as const)('keeps a %s lease of scope %p in Redis under %p', (kind, scope, prefix) => {
    expect(leaseStorageConfig(redis, kind, scope)).toMatchObject({ type: 'redis', prefix, fallback: 'error' });
  });

  it.each(['duty', 'worker'] as const)(
    'keeps %s leases in the SQLite file without Redis, each under its own prefix',
    (kind) => {
      const home = process.env['FRONTMCP_HOME'];
      process.env['FRONTMCP_HOME'] = '/var/lib/frontmcp';
      try {
        expect(leaseStorageConfig(undefined, kind, 'machine')).toEqual({
          type: 'sqlite',
          sqlite: { path: path.join('/var/lib/frontmcp', 'duties.sqlite') },
          prefix: `frontmcp:${kind}:`,
          fallback: 'error',
        });
      } finally {
        if (home === undefined) delete process.env['FRONTMCP_HOME'];
        else process.env['FRONTMCP_HOME'] = home;
      }
    },
  );
});

describe('leaseKey', () => {
  afterEach(() => {
    jest.mocked(findProjectRoot).mockRestore();
  });

  it('is the encoded server and holder names, the same for a machine and a cluster', () => {
    expect(leaseKey('inbox:watcher', 'machine', 'mail server')).toBe('mail%20server:inbox%3Awatcher');
    expect(leaseKey('inbox:watcher', 'cluster', 'mail server')).toBe('mail%20server:inbox%3Awatcher');
  });

  it('ends with the hash of the project root for a workspace, or of the working directory outside a project', () => {
    jest.mocked(findProjectRoot).mockReturnValueOnce('/srv/project');
    expect(leaseKey('indexer', 'workspace', 'demo')).toBe(`demo:indexer:${sha256Hex('/srv/project')}`);

    jest.mocked(findProjectRoot).mockReturnValueOnce(undefined);
    expect(leaseKey('indexer', 'workspace', 'demo')).toBe(`demo:indexer:${sha256Hex(process.cwd())}`);
  });

  it('differs between two project roots, and is the same for the processes of one', () => {
    jest.mocked(findProjectRoot).mockReturnValue('/srv/shop');
    const shopKey = leaseKey('rollup', 'workspace', 'reports');
    expect(leaseKey('rollup', 'workspace', 'reports')).toBe(shopKey);

    jest.mocked(findProjectRoot).mockReturnValue('/srv/blog');
    expect(leaseKey('rollup', 'workspace', 'reports')).not.toBe(shopKey);
  });
});

describe('where duties and workers start', () => {
  afterEach(() => {
    delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
    resetRuntimeContext();
  });

  it('is a long-lived process, not a serverless deployment', () => {
    expect(isLongLivedProcess()).toBe(true);

    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';
    resetRuntimeContext();
    expect(isLongLivedProcess()).toBe(false);
  });

  it('is a server, a container that asks for it, and not a server a build boots only to read it', () => {
    const readByABuild = configOf();
    markManifestMode(readByABuild);

    expect(startsBackgroundWork(configOf())).toBe(true);
    expect(startsBackgroundWork(configOf({ runBackground: true }))).toBe(true);
    expect(startsBackgroundWork(configOf({ runBackground: false }))).toBe(false);
    expect(startsBackgroundWork(readByABuild)).toBe(false);
  });
});

describe('LeaseClaims', () => {
  it('gives a key to one class, to any number of its instances, and names the holder to another class', () => {
    const claims = new LeaseClaims();

    expect(claims.claim('demo:inbox', InboxWatcher)).toBeUndefined();
    expect(claims.claim('demo:inbox', InboxWatcher)).toBeUndefined();
    expect(claims.claim('demo:inbox', OtherWatcher)).toBe('InboxWatcher');
    expect(claims.claim('demo:other', OtherWatcher)).toBeUndefined();
  });

  it('frees a key once every instance that took it released it', () => {
    const claims = new LeaseClaims();
    claims.claim('demo:inbox', InboxWatcher);
    claims.claim('demo:inbox', InboxWatcher);

    claims.release('demo:inbox');
    expect(claims.claim('demo:inbox', OtherWatcher)).toBe('InboxWatcher');

    claims.release('demo:inbox');
    claims.release('demo:inbox');
    expect(claims.claim('demo:inbox', OtherWatcher)).toBeUndefined();
  });
});
