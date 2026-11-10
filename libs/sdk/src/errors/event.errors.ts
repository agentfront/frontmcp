import { InternalMcpError } from './mcp.error';

/** Thrown at startup when two events of a server declare the same name: a subscription names its event by it. */
export class EventNameConflictError extends InternalMcpError {
  constructor(eventName: string) {
    super(
      `Event "${eventName}" is declared twice: each event of a server needs its own name. ` +
        'Rename one of them with @Event({ name }).',
      'EVENT_NAME_CONFLICT',
    );
  }
}
