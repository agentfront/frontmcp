import { Token } from '@frontmcp/sdk';

import { CacheStoreInterface } from './cache.types';

export const CacheStoreToken: Token<CacheStoreInterface> = Symbol('plugin:cache:store');
