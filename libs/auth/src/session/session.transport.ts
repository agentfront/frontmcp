// session/session.transport.ts
import { randomUUID } from '@frontmcp/utils';

export class TransportIdGenerator {
  /**
   * Create a transport session ID.
   * Generates JWT-style IDs for distributed session support.
   *
   * @returns A transport session ID (UUID without dashes)
   */
  static createId(): string {
    return randomUUID().replace(/-/g, '');
  }
}
