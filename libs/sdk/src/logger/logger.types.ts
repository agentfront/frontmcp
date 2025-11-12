import {
  LogTransportInterface,
  LogTransportMetadata,
  Type,
} from '../common';

export enum LoggerKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
}

export type ClassTokenLogger = {
  kind: LoggerKind.CLASS_TOKEN;
  provide: Type<LogTransportInterface>;
  metadata: LogTransportMetadata
};

export type LoggerRecord =
  | ClassTokenLogger
