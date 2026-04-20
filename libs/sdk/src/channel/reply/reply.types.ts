// file: libs/sdk/src/channel/reply/reply.types.ts

import { z } from '@frontmcp/lazy-zod';

/**
 * Input schema for the channel reply tool.
 */
export const channelReplyInputSchema = {
  channel_name: z.string().describe('The name of the channel to reply to'),
  text: z.string().describe('The reply text to send back through the channel'),
  meta: z.record(z.string(), z.string()).optional().describe('Optional metadata for the reply'),
};

/**
 * Input type for the channel reply tool.
 */
export type ChannelReplyInput = z.infer<z.ZodObject<typeof channelReplyInputSchema>>;
