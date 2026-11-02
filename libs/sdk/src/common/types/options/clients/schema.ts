// common/types/options/clients/schema.ts

import { z } from '@frontmcp/lazy-zod';
import { validatePattern } from '@frontmcp/utils';

import type { RawZodShape } from '../../common.types';
import type { ClientProfile, ClientProfilesOptionsInterface } from './interfaces';

const clientProfileSchema = z
  .object({
    structured: z.enum(['both', 'only', 'text']).optional(),
    annotations: z.enum(['full', 'no-numbers']).optional(),
    instructions: z.enum(['full', 'compact']).optional(),
  } satisfies RawZodShape<ClientProfile>)
  .strict();

const clientNameGlobSchema = z
  .string()
  .min(1, { message: 'a client profile key is a glob of clientInfo.name, such as "codex*"' })
  .refine((glob) => validatePattern(glob).valid, {
    message: 'a client profile key must be a glob of at most 500 characters with at most 20 wildcards',
  });

export const clientProfilesOptionsSchema = z.record(clientNameGlobSchema, clientProfileSchema);

export type ClientProfilesOptions = z.infer<typeof clientProfilesOptionsSchema>;
export type ClientProfilesOptionsInput = ClientProfilesOptionsInterface;
