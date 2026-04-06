import 'reflect-metadata';
import { FrontMcpChannelTokens } from '../tokens';
import { ChannelMetadata, ChannelNotification, frontMcpChannelMetadataSchema } from '../metadata';
import { ChannelContext } from '../interfaces';

/**
 * Decorator that marks a class as a Channel and provides metadata.
 *
 * @example
 * ```typescript
 * @Channel({
 *   name: 'deploy-alerts',
 *   description: 'CI/CD deployment notifications',
 *   source: { type: 'webhook', path: '/hooks/deploy' },
 *   twoWay: true,
 * })
 * class DeployChannel extends ChannelContext {
 *   async onEvent(payload: unknown): Promise<ChannelNotification> {
 *     return { content: `Deploy event received` };
 *   }
 * }
 * ```
 */
function FrontMcpChannel(providedMetadata: ChannelMetadata): ClassDecorator {
  return (target: any) => {
    const metadata = frontMcpChannelMetadataSchema.parse(providedMetadata);
    Reflect.defineMetadata(FrontMcpChannelTokens.type, true, target);
    for (const property in metadata) {
      if (FrontMcpChannelTokens[property as keyof typeof FrontMcpChannelTokens]) {
        Reflect.defineMetadata(
          FrontMcpChannelTokens[property as keyof typeof FrontMcpChannelTokens],
          (metadata as Record<string, unknown>)[property],
          target,
        );
      }
    }
    Reflect.defineMetadata(FrontMcpChannelTokens.metadata, metadata, target);
  };
}

/**
 * Handler type for function-based channels.
 */
export type ChannelMessageHandler = (
  payload: unknown,
  ctx?: ChannelContext,
) => ChannelNotification | Promise<ChannelNotification>;

/**
 * Function builder for channels (alternative to class-based @Channel decorator).
 *
 * @example
 * ```typescript
 * const ErrorChannel = channel({
 *   name: 'error-alerts',
 *   source: { type: 'app-event', event: 'error' },
 * })((payload) => ({
 *   content: `Error: ${(payload as any).message}`,
 *   meta: { severity: (payload as any).level },
 * }));
 * ```
 */
function frontMcpChannel(providedMetadata: ChannelMetadata): (handler: ChannelMessageHandler) => () => void {
  return (handler) => {
    const metadata = frontMcpChannelMetadataSchema.parse(providedMetadata);
    const channelFunction = function () {
      return handler;
    };
    Object.assign(channelFunction, {
      [FrontMcpChannelTokens.type]: 'function-channel',
      [FrontMcpChannelTokens.metadata]: metadata,
    });
    return channelFunction;
  };
}

/**
 * Channel decorator and function builder.
 *
 * - As a class decorator: `@Channel({ name: '...', source: {...} })`
 * - As a function builder: `channel({ name: '...', source: {...} })(handler)`
 */
export const Channel = FrontMcpChannel;
export const channel = frontMcpChannel;

/**
 * Type guard to check if a value is a class decorated with @Channel.
 */
export function isChannelClass(target: unknown): boolean {
  if (typeof target !== 'function') return false;
  return Reflect.getMetadata(FrontMcpChannelTokens.type, target) === true;
}

/**
 * Type guard to check if a value is a function-based channel.
 */
export function isChannelFunction(target: unknown): boolean {
  if (typeof target !== 'function') return false;
  return (target as unknown as Record<symbol, unknown>)[FrontMcpChannelTokens.type] === 'function-channel';
}
