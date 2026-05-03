import { type AdapterInterface } from '../interfaces';
import { type AdapterMetadata } from '../metadata';
import { type AdapterRecord } from '../records';
import { BaseEntry } from './base.entry';

export abstract class AdapterEntry extends BaseEntry<AdapterRecord, AdapterInterface, AdapterMetadata> {}
