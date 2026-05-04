import { type Type } from '@frontmcp/di';

import { type LogTransportInterface } from '../interfaces';
import { type LogTransportMetadata } from '../metadata';

export enum LoggerKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
}

export type LoggerClassToken = {
  kind: LoggerKind.CLASS_TOKEN;
  provide: Type<LogTransportInterface>;
  metadata: LogTransportMetadata;
};

export type LoggerRecord = LoggerClassToken;
