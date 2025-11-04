import { Icon, IconSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RawZodShape } from '../common.types';

export type ServerInfoOptions = {
  /* The name of the server */
  name: string;
  /* The name of the server */
  title?: string;
  /* The version of the server */
  version: string;
  /* The description of the server*/
  websiteUrl?: string;
  icons?: Icon[];
}


export const serverInfoOptionsSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  version: z.string(),
  websiteUrl: z.string().optional(),
  icons: z.array(IconSchema).optional(),
} satisfies RawZodShape<ServerInfoOptions>);