import type { Reference } from '@frontmcp/sdk';

import type { ResultHandleStore } from './result-handle.store';
import type { ResultHandlesPluginOptions } from './result-handles.options';

/** The store of folded answers: `this.get(ResultHandleStoreToken)`. */
export const ResultHandleStoreToken = Symbol('plugin:result-handles:store') as Reference<ResultHandleStore>;

/** The plugin's options, with their defaults. */
export const ResultHandlesConfigToken = Symbol('plugin:result-handles:config') as Reference<ResultHandlesPluginOptions>;
