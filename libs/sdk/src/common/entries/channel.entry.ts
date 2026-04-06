import { BaseEntry, EntryOwnerRef } from './base.entry';
import type { ChannelRecord } from '../records';
import type { ChannelContext } from '../interfaces';
import type { ChannelMetadata, ChannelSourceConfig } from '../metadata/channel.metadata';

/**
 * Abstract base class for channel entries.
 *
 * ChannelEntry represents a registered channel in the registry and provides
 * the interface for creating ChannelContext instances and accessing metadata.
 *
 * Concrete implementation: ChannelInstance (in libs/sdk/src/channel/channel.instance.ts)
 */
export abstract class ChannelEntry extends BaseEntry<ChannelRecord, ChannelContext, ChannelMetadata> {
  /**
   * Owner reference (scope, app, or plugin).
   */
  owner: EntryOwnerRef;

  /**
   * The name of the channel, as declared in the metadata.
   */
  name: string;

  /**
   * The full name of the channel, including the owner name as prefix.
   */
  fullName: string;

  /**
   * The source configuration for this channel.
   */
  get source(): ChannelSourceConfig {
    return this.metadata.source;
  }

  /**
   * Whether this channel supports two-way communication.
   */
  get twoWay(): boolean {
    return this.metadata.twoWay === true;
  }

  /**
   * Static metadata appended to every notification.
   */
  get staticMeta(): Record<string, string> | undefined {
    return this.metadata.meta;
  }

  /**
   * Tags for categorization.
   */
  getTags(): string[] {
    return this.metadata.tags ?? [];
  }

  // ============================================================================
  // Abstract Methods
  // ============================================================================

  /**
   * Create a channel context for handling an event.
   *
   * @param authInfo - Auth info for the current request context
   * @returns ChannelContext instance ready for onEvent/onReply
   */
  abstract create(authInfo: Partial<Record<string, unknown>>): ChannelContext;

  /**
   * Push a notification to subscribed Claude Code sessions.
   *
   * @param content - The notification content
   * @param meta - Optional additional metadata
   * @param targetSessionId - If set, deliver ONLY to this session (session isolation)
   */
  abstract pushNotification(content: string, meta?: Record<string, string>, targetSessionId?: string): void;
}
