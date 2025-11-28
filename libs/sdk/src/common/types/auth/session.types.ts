import { z } from 'zod';
import { RawZodShape } from '../common.types';
import { HttpRequestIntent } from '../../utils';

/**
 * Decoded JWT payload (if any) or empty object
 */
export type UserClaim = {
  iss: string;
  sid?: string;
  sub: string;
  exp?: number;
  iat?: number;
  aud?: string | string[];
  email?: string;
  username?: string;
  preferred_username?: string;
  name?: string;
  picture?: string;
};
export const userClaimSchema = z
  .object({
    iss: z.string(),
    sid: z.string().optional(),
    sub: z.string(),
    exp: z.number().optional(),
    iat: z.number().optional(),
    aud: z.union([z.string(), z.array(z.string())]).optional(),
    email: z.string().optional(),
    username: z.string().optional(),
    preferred_username: z.string().optional(),
    name: z.string().optional(),
    picture: z.string().optional(),
  } satisfies RawZodShape<UserClaim>)
  .passthrough();

export type SessionIdPayload = {
  /* The actual node id that handle the transport session */
  nodeId: string;
  /* The signature of the token used to create the session */
  authSig: string;
  /* The unique id of the session */
  uuid: string;
  /* The timestamp of the session creation */
  iat: number;
  /* The protocol used in existing transport - optional for stateless mode */
  protocol?: HttpRequestIntent;
  /* True if session was created in public mode (anonymous access) */
  isPublic?: boolean;
};
export const sessionIdPayloadSchema = z.object({
  nodeId: z.string(),
  authSig: z.string(),
  uuid: z.string().uuid(),
  iat: z.number(),
  protocol: z.enum(['legacy-sse', 'sse', 'streamable-http', 'stateful-http', 'stateless-http']).optional(),
  isPublic: z.boolean().optional(),
} satisfies RawZodShape<SessionIdPayload>);

export interface Authorization {
  token: string;
  user: UserClaim;
  session?: {
    id: string;
    payload: SessionIdPayload;
  };
}

export const sessionIdSchema = z.object({
  id: z.string(),
  payload: sessionIdPayloadSchema,
} satisfies RawZodShape<{ id: string; payload: SessionIdPayload }>);

export const authorizationSchema = z.object({
  token: z.string(),
  session: sessionIdSchema.optional(),
  user: userClaimSchema,
} satisfies RawZodShape<Authorization>);
