import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/** Fires for each audit record. Only callers with the admin role may list it or subscribe to it. */
export const auditLogged = event({
  name: 'audit.logged',
  description: 'Fires for each audit record',
  payloadSchema: { action: z.string(), actor: z.string() },
  authorities: 'admin',
});
