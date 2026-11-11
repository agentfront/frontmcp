import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';
import { randomUUID } from '@frontmcp/utils';

import { mailUpstream } from '../mail-upstream';

const inputSchema = {
  to: z.string().describe('The mailbox: the subject of its owner'),
  from: z.string(),
  subject: z.string(),
};
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

/** Demo only: makes a message arrive in a mailbox of the mocked provider. */
@Tool({
  name: 'simulate_incoming_mail',
  description: 'Demo only: make a message arrive in a mailbox of the mocked mail provider',
  inputSchema,
})
export default class SimulateIncomingMailTool extends ToolContext {
  /** Hand the message to the mocked provider, which tells the watchers of that mailbox. */
  async execute({ to, from, subject }: Input) {
    const messageId = `msg_${randomUUID()}`;
    mailUpstream.receive(to, { id: messageId, from, subject });
    return { messageId, watchers: mailUpstream.watcherCount(to) };
  }
}
