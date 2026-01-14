// auth/session/session.transport.ts
import { randomUUID } from '@frontmcp/utils';

export class TransportIdGenerator {
  /**
   * Create a transport session ID.
   * Always generates JWT-style IDs for distributed session support.
   *
   * @param _mode - Deprecated parameter, kept for backwards compatibility
   * @returns A JWT-style transport session ID (UUID without dashes)
   */
  static createId(_mode?: 'jwt'): string {
    // Always generate JWT-style IDs (UUID without dashes)
    return randomUUID().replace(/-/g, '');
  }
}
