import { base64urlEncode, dirname, mkdir, randomBytes, readFile, rename, unlink, writeFile } from '@frontmcp/utils';

/** What a native sign-in keeps: the tokens, and what it needs to refresh them. */
export interface NativeTokenSet {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
  /** When the access token expires, in epoch milliseconds; absent when the server did not say. */
  expiresAt?: number;
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  resource?: string[];
}

/** Where native sign-ins keep their tokens, one set per key. */
export interface NativeTokenStore {
  get(key: string): Promise<NativeTokenSet | undefined>;
  set(key: string, tokens: NativeTokenSet): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Tokens kept for the life of the process. */
export function memoryTokenStore(): NativeTokenStore {
  const entries = new Map<string, NativeTokenSet>();
  return {
    get: async (key) => entries.get(key),
    set: async (key, tokens) => void entries.set(key, tokens),
    delete: async (key) => void entries.delete(key),
  };
}

/**
 * Tokens kept in one JSON file, readable by the current user only (mode 0600, in a 0700 directory when it creates
 * one). Each write replaces the file whole, so a crash never leaves half of it.
 */
export function fileTokenStore(filePath: string): NativeTokenStore {
  let writes: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<Record<string, NativeTokenSet>> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath));
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, NativeTokenSet>) : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  };
  const update = (change: (entries: Record<string, NativeTokenSet>) => void): Promise<void> => {
    const next = writes.then(async () => {
      const entries = await read();
      change(entries);
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      const tempPath = `${filePath}.${base64urlEncode(randomBytes(6))}.tmp`;
      await writeFile(tempPath, JSON.stringify(entries, null, 2), { mode: 0o600 });
      try {
        await rename(tempPath, filePath);
      } catch (error) {
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
    });
    writes = next.catch(() => undefined);
    return next;
  };
  return {
    get: async (key) => {
      await writes;
      return (await read())[key];
    },
    set: (key, tokens) => update((entries) => void (entries[key] = tokens)),
    delete: (key) => update((entries) => void delete entries[key]),
  };
}
