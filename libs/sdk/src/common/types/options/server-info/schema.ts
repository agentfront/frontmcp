// common/types/options/server-info/schema.ts
// Zod schema for server info configuration

import { IconSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RawZodShape } from '../../common.types';
import type { ServerInfoOptionsInterface } from './interfaces';

/**
 * Server info options Zod schema.
 */
export const serverInfoOptionsSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  version: z.string(),
  websiteUrl: z.url().optional(),
  icons: z.array(IconSchema).optional(),
} satisfies RawZodShape<ServerInfoOptionsInterface>);

/**
 * Server info options type (with defaults applied).
 */
export type ServerInfoOptions = z.infer<typeof serverInfoOptionsSchema>;

/**
 * Server info options input type (for user configuration).
 */
export type ServerInfoOptionsInput = z.input<typeof serverInfoOptionsSchema>;
