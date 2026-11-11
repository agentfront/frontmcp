// file: libs/sdk/src/channel/channel.utils.ts

import 'reflect-metadata';

import type { ServerCapabilities } from '@frontmcp/protocol';

import { FrontMcpChannelTokens } from '../common';
import { isChannelClass, isChannelFunction } from '../common/decorators/channel.decorator';
import type { ChannelType } from '../common/interfaces/channel.interface';
import type { ChannelMetadata } from '../common/metadata/channel.metadata';
import { ChannelKind, type ChannelRecord } from '../common/records/channel.record';

/**
 * The MCP notification method for Claude Code channels.
 * This is an experimental extension, not part of the standard MCP spec.
 */
export const CHANNEL_NOTIFICATION_METHOD = 'notifications/claude/channel';

/** What `servesClaudeCodeChannels()` reads of a scope: its channels, and its events with the `channel` option. */
export interface ClaudeCodeChannelScope {
  channels?: { hasAny(): boolean };
  events?: { getChannelEvents(): readonly unknown[] };
}

/** Whether a scope pushes into Claude Code sessions: it has a channel, or an event with `channel`. */
export function servesClaudeCodeChannels(scope: ClaudeCodeChannelScope): boolean {
  const tellsEvents = (scope.events?.getChannelEvents().length ?? 0) > 0;
  return scope.channels?.hasAny() === true || tellsEvents;
}

/** The capability a scope that pushes into Claude Code sessions advertises: `experimental['claude/channel']`. */
export function channelCapabilitiesOf(scope: ClaudeCodeChannelScope): Partial<ServerCapabilities> {
  if (!servesClaudeCodeChannels(scope)) return {};
  return { experimental: { 'claude/channel': {} } };
}

const UNSAFE_META_KEY_CHARACTERS = /[^A-Za-z0-9_]/g;

/**
 * A notification's `meta` as Claude Code takes it. Claude Code drops a key that has anything but letters, digits
 * and underscores, so any other character becomes `_`. A key that is empty, and a value that is not there, are left
 * out. Every other value is sent as a string.
 */
export function channelMetaOf(meta: Record<string, unknown>): Record<string, string> {
  const safeMeta: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    const safeKey = key.replace(UNSAFE_META_KEY_CHARACTERS, '_');
    if (safeKey === '' || value === undefined || value === null) continue;
    safeMeta[safeKey] = String(value);
  }
  return safeMeta;
}

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
