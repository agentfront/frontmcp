import { z } from '@frontmcp/lazy-zod';

import { InvalidSharedServerOptionsError } from '../errors/shared-server.errors';

/** How sessions reach a shared local server: an owner-only Unix socket, or loopback HTTP. */
export type SharedServerTransport = 'unix' | 'http';

export interface SharedServerOptions {
  /** Names the server: every session started with the same key on this machine shares one server process. */
  key: string;
  /** @default 'unix', or 'http' on Windows */
  transport?: SharedServerTransport;
}

export interface ResolvedSharedServerOptions {
  key: string;
  transport: SharedServerTransport;
}

// Lowercase, and no trailing dot: a case-insensitive file system, or Windows, would give two keys one folder.
const KEY_FORMAT =
  'key must be 1 to 64 lowercase letters, digits, ".", "_" or "-", starting and ending with a letter or digit';
const WINDOWS_DEVICE = "key can't be a device name Windows reserves (con, prn, aux, nul, com0-9 and lpt0-9)";

const sharedServerOptionsSchema = z
  .object({
    key: z
      .string({ message: 'key is required' })
      .regex(/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/, KEY_FORMAT)
      .refine((key) => !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/.test(key), WINDOWS_DEVICE),
    transport: z.enum(['unix', 'http'], { message: "transport must be 'unix' or 'http'" }).optional(),
  })
  .strict();

/** Validate `runShared()`'s options and resolve the transport for `platform`. */
export function parseSharedServerOptions(
  input: unknown,
  platform: NodeJS.Platform = process.platform,
): ResolvedSharedServerOptions {
  const result = sharedServerOptionsSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(({ path, message }) =>
      path.length ? `${path.join('.')}: ${message}` : message,
    );
    throw new InvalidSharedServerOptionsError(issues.join('; '));
  }
  const { key, transport = platform === 'win32' ? 'http' : 'unix' } = result.data;
  if (transport === 'unix' && platform === 'win32') {
    throw new InvalidSharedServerOptionsError(
      "transport: a Unix socket can't be kept owner-only on Windows; use transport 'http'",
    );
  }
  return { key, transport };
}
