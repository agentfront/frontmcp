import { App } from '@frontmcp/sdk';

import { appointmentCreated } from './events/appointment-created.event';
import { appointmentReply } from './events/appointment-reply.event';
import BookAppointmentTool from './tools/book-appointment.tool';
import ReplyToCustomerTool from './tools/reply-to-customer.tool';

/** The appointment events and the tools that publish them. */
@App({
  name: 'appointments',
  description: 'Customers book appointments; the business is told, and its replies reach the customer',
  events: [appointmentCreated, appointmentReply],
  tools: [BookAppointmentTool, ReplyToCustomerTool],
})
export class AppointmentsApp {}
