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

const KEY_FORMAT = 'key must be 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit';

const sharedServerOptionsSchema = z
  .object({
    key: z.string({ message: 'key is required' }).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, KEY_FORMAT),
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
