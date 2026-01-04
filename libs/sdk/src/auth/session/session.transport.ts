// auth/session/session.transport.ts
import { randomUUID } from '@frontmcp/utils';
import { TransportIdMode } from '../../common';

export class TransportIdGenerator {
  static createId(mode: TransportIdMode): string {
    switch (mode) {
      case 'uuid':
        return randomUUID();
      case 'jwt':
        // TODO: generate a JWT with a random UUID as the jti,
        return randomUUID().replace(/-/g, '');
      default:
        throw new Error(`Unknown transport id mode: ${mode}`);
    }
  }
}
