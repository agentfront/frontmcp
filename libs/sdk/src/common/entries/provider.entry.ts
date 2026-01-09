import { BaseEntry } from './base.entry';
import type { ProviderRecord } from '../records';
import type { ProviderInterface } from '../interfaces';
import type { ProviderMetadata } from '../metadata';

abstract class ProviderEntry extends BaseEntry<ProviderRecord, ProviderInterface, ProviderMetadata> {}

export { ProviderEntry };
