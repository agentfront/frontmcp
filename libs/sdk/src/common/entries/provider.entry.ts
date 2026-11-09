import type { ProviderMetadata } from '../metadata';
import type { ProviderRecord } from '../records';
import { BaseEntry } from './base.entry';

abstract class ProviderEntry extends BaseEntry<ProviderRecord, unknown, ProviderMetadata> {}

export { ProviderEntry };
