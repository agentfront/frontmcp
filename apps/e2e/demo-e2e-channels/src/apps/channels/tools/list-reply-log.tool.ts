import { Tool, ToolContext } from '@frontmcp/sdk';
import { replyLog } from '../channels/chat-bridge.channel';

const inputSchema = {};

@Tool({
  name: 'list-reply-log',
  description: 'List all replies received by the chat-bridge channel (for testing two-way communication)',
  inputSchema,
})
export default class ListReplyLogTool extends ToolContext<typeof inputSchema> {
  async execute() {
    return {
      replies: replyLog,
      count: replyLog.length,
    };
  }
}
