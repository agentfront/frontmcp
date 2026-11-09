// file: libs/sdk/src/channel/channel.types.ts

import type { EntryOwnerRef } from '../common';
import type { ChannelInstance } from './channel.instance';

/**
 * A row in the channel registry's index.
 */
export interface IndexedChannel {
  /** The channel instance */
  instance: ChannelInstance;
  /** Owner of this channel entry */
  owner: EntryOwnerRef;
  /** The resolved MCP-safe name */
  resolvedName: string;
}
