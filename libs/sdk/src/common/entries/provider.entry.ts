import { BaseEntry } from './base.entry';
import { ProviderRecord } from '../records';
import { ProviderInterface } from '../interfaces';
import { ProviderMetadata } from '../metadata';


abstract class ProviderEntry extends BaseEntry<ProviderRecord, ProviderInterface, ProviderMetadata> {


}


export {
  ProviderEntry,
};