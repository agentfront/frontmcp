import { BaseEntry } from './base.entry';
import { LogTransportInterface } from '../interfaces';
import { LoggerRecord } from '../records';
import { LogTransportMetadata } from '../metadata';


export abstract class LoggerEntry extends BaseEntry<LoggerRecord, LogTransportInterface, LogTransportMetadata> {


}

