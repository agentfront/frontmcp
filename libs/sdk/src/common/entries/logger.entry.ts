import { type LogTransportInterface } from '../interfaces';
import { type LogTransportMetadata } from '../metadata';
import { type LoggerRecord } from '../records';
import { BaseEntry } from './base.entry';

export abstract class LoggerEntry extends BaseEntry<LoggerRecord, LogTransportInterface, LogTransportMetadata> {}
