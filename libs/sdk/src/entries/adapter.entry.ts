import { BaseEntry } from './base.entry';
import { AdapterRecord } from '../records';
import { AdapterInterface } from '../interfaces';
import { AdapterMetadata } from '../metadata';


export abstract class AdapterEntry extends BaseEntry<AdapterRecord, AdapterInterface, AdapterMetadata> {


}

