import { Type } from '@frontmcp/di';
import { ChannelContext } from '../interfaces';
import { ChannelMetadata } from '../metadata';

/**
 * Discriminator enum for channel record types.
 */
export enum ChannelKind {
  /** Channel defined as a class decorated with @Channel */
  CLASS_TOKEN = 'CLASS_TOKEN',
  /** Channel defined using channel() function builder */
  FUNCTION = 'FUNCTION',
}

/**
 * Record for class-based channels decorated with @Channel.
 *
 * @example
 * ```typescript
 * @Channel({
 *   name: 'deploy-alerts',
 *   source: { type: 'webhook', path: '/hooks/deploy' },
 * })
 * export class DeployChannel extends ChannelContext { ... }
 * ```
 */
export interface ChannelClassTokenRecord {
  kind: ChannelKind.CLASS_TOKEN;
  provide: Type<ChannelContext>;
  metadata: ChannelMetadata;
}

/**
 * Record for function-based channels created with channel().
 *
 * @example
 * ```typescript
 * const ErrorChannel = channel({
 *   name: 'error-alerts',
 *   source: { type: 'app-event', event: 'error' },
 * })((payload) => ({
 *   content: `Error: ${payload.message}`,
 * }));
 * ```
 */
export interface ChannelFunctionTokenRecord {
  kind: ChannelKind.FUNCTION;
  // NOTE: `any` is intentional - function providers must be loosely typed
  // to support various payload types at runtime
  provide: (...args: any[]) => any | Promise<any>;
  metadata: ChannelMetadata;
}

/**
 * Union type of all possible channel record types.
 */
export type ChannelRecord = ChannelClassTokenRecord | ChannelFunctionTokenRecord;
