import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { ticketChanges } from '../events/ticket-updated.event';

const inputSchema = { ticketId: z.string(), queue: z.string().default('support') };
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'update-ticket',
  description: 'Records a change of a ticket, which ticket.updated reports to the clients that poll it',
  inputSchema,
})
export default class UpdateTicketTool extends ToolContext {
  async execute({ ticketId, queue }: Input) {
    ticketChanges.push({ ticketId, queue });
    return { position: ticketChanges.length };
  }
}
