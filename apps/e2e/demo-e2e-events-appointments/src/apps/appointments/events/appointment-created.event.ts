import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/**
 * A customer booked an appointment. Staff of the business subscribe; each booking is published to the staff of its
 * business only, with an opaque conversation id instead of who booked.
 */
export const appointmentCreated = event({
  name: 'appointment.created',
  description: 'A customer booked an appointment with your business',
  payloadSchema: {
    appointmentId: z.string(),
    conversationId: z.string().describe('Opaque id of the conversation with the customer; use it to reply'),
    service: z.string(),
    startsAt: z.string(),
  },
  authorities: 'staff',
});
