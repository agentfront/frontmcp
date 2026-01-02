import { Type, Token, depsOfClass, isClass, getMetadata } from '@frontmcp/di';
import { FrontMcpLogTransportTokens, LogTransportMetadata, LogTransportType, LogTransportInterface } from '../common';
import { LoggerKind, LoggerRecord } from './logger.types';

export function collectLoggerMetadata(cls: LogTransportType): LogTransportMetadata {
  return Object.entries(FrontMcpLogTransportTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as LogTransportMetadata);
}

/**
 * Normalize a raw app metadata list into useful maps/sets.
 * - tokens: all provided tokens
 * - defs: LoggerRecord by token
 * - graph: initialized adjacency map (empty sets)
 */
export function normalizeLogger(item: any): LoggerRecord {
  if (isClass(item)) {
    const metadata = collectLoggerMetadata(item);
    return { kind: LoggerKind.CLASS_TOKEN, provide: item as Type<LogTransportInterface>, metadata };
  }

  const name = (item as any)?.name ?? String(item);
  throw new Error(`Invalid app '${name}'. Expected a class or remote app config object.`);
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - CLASS / CLASS_TOKEN: deps come from the class constructor
 */
export function loggerDiscoveryDeps(rec: LoggerRecord): Token[] {
  switch (rec.kind) {
    // TODO: FEATURE/LOGGING add support for LoggerKind.VALUE as url based loggers
    case LoggerKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
  }
}
