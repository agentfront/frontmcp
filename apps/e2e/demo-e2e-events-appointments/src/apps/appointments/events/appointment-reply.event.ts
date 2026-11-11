import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/** The business answered a booking. Each reply is published to the customer who booked, and to nobody else. */
export const appointmentReply = event({
  name: 'appointment.reply',
  description: 'The business replied about one of your appointments',
  payloadSchema: {
    appointmentId: z.string(),
    conversationId: z.string(),
    message: z.string(),
  },
});
