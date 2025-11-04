import { Token } from '@frontmcp/sdk';
import InMemoryDcrStore from './dcr.memory.store';
import RedisDcrStore, { RedisDcStoreOptions } from './dcr.redis.store';
import RemoteDcrStore, { RemoteDcrStoreOptions } from './dcr.remote.store';
import { DcrStoreInterface } from './dcr.store.types';

export interface DcrStoreFactoryOptions {
  kind: 'memory' | 'redis' | 'remote';
  redis?: RedisDcStoreOptions;
  remote?: RemoteDcrStoreOptions;
}

export function makeDcrStore(opts: DcrStoreFactoryOptions): DcrStoreInterface {
  switch (opts.kind) {
    case 'memory':
      return new InMemoryDcrStore();
    case 'redis':
      if (!opts.redis) throw new Error('Redis DCR store requires redis options');
      return new RedisDcrStore(opts.redis);
    case 'remote':
      if (!opts.remote) throw new Error('Remote DCR store requires remote options');
      return new RemoteDcrStore(opts.remote);
    default:
      throw new Error('Unknown DCR store kind');
  }
}

export const DcrStore: Token<DcrStoreInterface> = Symbol('DcrStore');
