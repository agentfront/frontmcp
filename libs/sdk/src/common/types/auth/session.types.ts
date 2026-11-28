// SDK-specific Authorization types (not in @frontmcp/auth barrel due to name conflict)
import {
  isAuthPrincipal,
  sessionIdPayloadSchema,
  userClaimSchema,
  type AuthPrincipal,
  type RawZodShape,
  type SessionIdPayload,
  type UserClaim,
} from '@frontmcp/auth';
import { internalZ as z } from '@frontmcp/lazy-zod';

// Re-export non-conflicting session types from @frontmcp/auth
export { aiPlatformTypeSchema, userClaimSchema, sessionIdPayloadSchema } from '@frontmcp/auth';
export type { TransportProtocolType, AIPlatformType, UserClaim, SessionIdPayload } from '@frontmcp/auth';
export type { AuthPrincipal, PrincipalKind, PrincipalResolver } from '@frontmcp/auth';

export interface Authorization {
  token: string;
  user: UserClaim;
  /**
   * Who the token speaks for: a person who signed in, a machine (a client acting for itself) or no one, with its
   * subject, client, authentication time and grant type. Session verification sets it: as the claims name it, or as
   * the auth options' `principal` resolver decides.
   */
  principal?: AuthPrincipal;
  session?: {
    id: string;
    /** Payload may be undefined when session validation failed but ID is passed for transport lookup */
    payload?: SessionIdPayload;
  };
  /**
   * The issuer of a token from another issuer than the server's own (transparent mode with
   * `additionalIssuers` or `verifyIssuer: false`): its subject names a principal only together with it.
   */
  principalIssuer?: string;
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
  principal: z.custom<AuthPrincipal>(isAuthPrincipal).optional(),
  principalIssuer: z.string().optional(),
} satisfies RawZodShape<Authorization>);
