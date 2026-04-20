// SDK-specific Authorization types (not in @frontmcp/auth barrel due to name conflict)
import {
  sessionIdPayloadSchema,
  userClaimSchema,
  type RawZodShape,
  type SessionIdPayload,
  type UserClaim,
} from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

// Re-export non-conflicting session types from @frontmcp/auth
export { aiPlatformTypeSchema, userClaimSchema, sessionIdPayloadSchema } from '@frontmcp/auth';
export type { TransportProtocolType, AIPlatformType, UserClaim, SessionIdPayload } from '@frontmcp/auth';

export interface Authorization {
  token: string;
  user: UserClaim;
  session?: {
    id: string;
    /** Payload may be undefined when session validation failed but ID is passed for transport lookup */
    payload?: SessionIdPayload;
  };
}

export const sessionIdSchema = z.object({
  id: z.string(),
  /** Payload is optional - may be undefined when session validation failed but ID is passed for transport lookup */
  payload: sessionIdPayloadSchema.optional(),
} satisfies RawZodShape<{ id: string; payload?: SessionIdPayload }>);

export const authorizationSchema = z.object({
  token: z.string(),
  session: sessionIdSchema.optional(),
  user: userClaimSchema,
} satisfies RawZodShape<Authorization>);
