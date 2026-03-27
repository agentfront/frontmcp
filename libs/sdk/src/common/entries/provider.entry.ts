import { BaseEntry } from './base.entry';
import type { ProviderRecord } from '../records';
import type { ProviderMetadata } from '../metadata';

abstract class ProviderEntry extends BaseEntry<ProviderRecord, unknown, ProviderMetadata> {}

export { ProviderEntry };
