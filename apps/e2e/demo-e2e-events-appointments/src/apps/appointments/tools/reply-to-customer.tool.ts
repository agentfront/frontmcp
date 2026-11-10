import { z } from '@frontmcp/lazy-zod';
import { InvalidInputError, Tool, ToolContext } from '@frontmcp/sdk';

import { findAppointment } from '../appointment-book';
import { appointmentReply } from '../events/appointment-reply.event';

const inputSchema = { appointmentId: z.string(), message: z.string() };
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

/** A receptionist or admin replies to the customer who booked an appointment of their business. */
@Tool({
  name: 'reply_to_customer',
  description: 'Reply to the customer who booked an appointment with your business',
  inputSchema,
  authorities: 'staff',
})
export default class ReplyToCustomerTool extends ToolContext {
  /** Send the reply to the customer who booked, when the appointment belongs to the caller's business. */
  async execute({ appointmentId, message }: Input) {
    const appointment = findAppointment(appointmentId);
    if (!appointment || appointment.businessId !== this.auth.claims['tenantId']) {
      this.fail(new InvalidInputError(`No appointment ${appointmentId} in your business`));
    }
    const { conversationId, customerSub } = appointment;
    const { matched } = await this.events.publish(
      appointmentReply,
      { appointmentId, conversationId, message },
      { audience: { sub: customerSub } },
    );
    return { delivered: matched > 0 };
  }
}
