// file: libs/sdk/src/channel/channel.utils.ts

import 'reflect-metadata';
import { FrontMcpChannelTokens } from '../common';
import type { ChannelRecord } from '../common/records/channel.record';
import { ChannelKind } from '../common/records/channel.record';
import type { ChannelMetadata } from '../common/metadata/channel.metadata';
import type { ChannelType } from '../common/interfaces/channel.interface';
import { isChannelClass, isChannelFunction } from '../common/decorators/channel.decorator';

/**
 * Normalize a ChannelType (class, function, or descriptor) into a ChannelRecord.
 *
 * @param def - The channel definition to normalize
 * @returns A ChannelRecord suitable for registry consumption
 * @throws Error if the definition is not a valid channel type
 */
export function normalizeChannel(def: ChannelType | ChannelRecord): ChannelRecord {
  // Already a record
  if (typeof def === 'object' && def !== null && 'kind' in def && 'provide' in def && 'metadata' in def) {
    return def as ChannelRecord;
  }

  // Class-based channel
  if (typeof def === 'function' && isChannelClass(def)) {
    const metadata = Reflect.getMetadata(FrontMcpChannelTokens.metadata, def) as ChannelMetadata;
    if (!metadata) {
      throw new Error(`Channel class "${def.name}" is missing @Channel() metadata`);
    }
    return {
      kind: ChannelKind.CLASS_TOKEN,
      provide: def as any,
      metadata,
    };
  }

  // Function-based channel
  if (typeof def === 'function' && isChannelFunction(def)) {
    const metadata = (def as unknown as Record<symbol, unknown>)[FrontMcpChannelTokens.metadata] as ChannelMetadata;
    if (!metadata) {
      throw new Error('Channel function is missing metadata');
    }
    return {
      kind: ChannelKind.FUNCTION,
      provide: def as any,
      metadata,
    };
  }

  throw new Error(`Invalid channel definition: expected a @Channel() class or channel() function, got ${typeof def}`);
}

/**
 * Collect channel definitions from metadata arrays.
 *
 * @param channelDefs - Array of channel definitions
 * @returns Array of normalized ChannelRecords
 */
export function normalizeChannels(channelDefs: (ChannelType | ChannelRecord)[]): ChannelRecord[] {
  return channelDefs.map(normalizeChannel);
}
