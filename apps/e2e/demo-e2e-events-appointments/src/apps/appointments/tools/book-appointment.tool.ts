import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { bookAppointment } from '../appointment-book';
import { appointmentCreated } from '../events/appointment-created.event';

const inputSchema = {
  businessId: z.string().describe('The business to book with'),
  service: z.string(),
  startsAt: z.string().describe('ISO 8601 date and time'),
};
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

/** A customer books an appointment with a business. */
@Tool({ name: 'book_appointment', description: 'Book an appointment with a business', inputSchema })
export default class BookAppointmentTool extends ToolContext {
  /** Record the booking, then tell the admins and receptionists of that business only. */
  async execute({ businessId, service, startsAt }: Input) {
    const appointment = bookAppointment({ businessId, service, startsAt, customerSub: this.auth.user.sub });
    const { appointmentId, conversationId } = appointment;
    await this.events.publish(
      appointmentCreated,
      { appointmentId, conversationId, service, startsAt },
      { audience: { tenantId: businessId, roles: { any: ['admin', 'receptionist'] } } },
    );
    return { appointmentId, conversationId };
  }
}
