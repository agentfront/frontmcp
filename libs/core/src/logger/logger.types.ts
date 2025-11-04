import {
  LogTransportInterface,
  LogTransportMetadata,
  Type,
} from '@frontmcp/sdk';

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
