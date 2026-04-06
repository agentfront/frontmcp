import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { simulateIncomingMessage, sentMessages } from '../channels/messaging-service.channel';

const inputSchema = {
  from: z.string().describe('Sender name/ID'),
  text: z.string().describe('Incoming message text'),
  chatId: z.string().describe('Chat/conversation ID'),
};

@Tool({
  name: 'simulate-incoming',
  description: 'Simulate an incoming message from the messaging service (for testing)',
  inputSchema,
})
export default class SimulateIncomingTool extends ToolContext<typeof inputSchema> {
  async execute(input: { from: string; text: string; chatId: string }) {
    simulateIncomingMessage(input.from, input.text, input.chatId);
    return { simulated: true, from: input.from };
  }
}

const listSentSchema = {};

@Tool({
  name: 'list-sent-messages',
  description: 'List all messages sent through the messaging service (for testing)',
  inputSchema: listSentSchema,
})
export class ListSentMessagesTool extends ToolContext<typeof listSentSchema> {
  async execute() {
    return { messages: sentMessages, count: sentMessages.length };
  }
}
