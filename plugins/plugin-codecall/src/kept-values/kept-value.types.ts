import type { ReferenceEntry } from '@enclave-vm/core/worker';

import type { Reference } from '@frontmcp/sdk';

import type { KeptValueStore } from './kept-value.store';

/** A kept value: as it is, or a large string as the sidecar entry a later run starts with. */
export type KeptValue = { value: unknown } | { reference: ReferenceEntry };

/** The store of kept values: `this.get(KeptValueStoreToken)`, registered while `keep.enabled` is true. */
export const KeptValueStoreToken = Symbol('plugin:codecall:kept-values') as Reference<KeptValueStore>;
