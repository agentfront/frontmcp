import { randomUUID } from '@frontmcp/utils';

/** An appointment as the server keeps it. Only the server knows who booked it. */
export interface Appointment {
  appointmentId: string;
  /** The opaque id of the conversation between the business and the customer, safe to put in an event. */
  conversationId: string;
  businessId: string;
  service: string;
  startsAt: string;
  /** The subject of the customer who booked: never sent to the business in an event. */
  customerSub: string;
}

const appointments = new Map<string, Appointment>();

/** Record a booking, giving it an appointment id and an opaque conversation id. */
export function bookAppointment(booking: Omit<Appointment, 'appointmentId' | 'conversationId'>): Appointment {
  const appointment = {
    ...booking,
    appointmentId: `apt_${randomUUID()}`,
    conversationId: `conv_${randomUUID()}`,
  };
  appointments.set(appointment.appointmentId, appointment);
  return appointment;
}

/** The appointment of an id, when there is one. */
export function findAppointment(appointmentId: string): Appointment | undefined {
  return appointments.get(appointmentId);
}
