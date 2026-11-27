import {
  base64urlEncode,
  dirname,
  mkdir,
  pathResolve,
  randomBytes,
  readFile,
  rename,
  unlink,
  writeFile,
} from '@frontmcp/utils';

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

/** Per file, the updates in flight of every file store on it in this process, which run one at a time. */
const fileUpdates = new Map<string, Promise<unknown>>();

/**
 * Tokens kept in one JSON file, readable by the current user only (mode 0600, in a 0700 directory when it creates
 * one). Each write replaces the file whole, so a crash never leaves half of it, and the stores on one file in a
 * process update it one at a time.
 *
 * It is for one process at a time, such as one run of a CLI: two processes that update the file at once can each
 * replace the other's update, and two that refresh the same tokens at once make the provider refuse the second
 * refresh token, which ends that sign-in. Tokens that several processes use need a {@link NativeTokenStore} over a
 * store with transactional updates.
 */
export function fileTokenStore(filePath: string): NativeTokenStore {
  const fileKey = pathResolve(filePath);
  // Without a prototype, a key such as `constructor` finds nothing, and `__proto__` is a key like any other.
  const read = async (): Promise<Record<string, NativeTokenSet>> => {
    const entries: Record<string, NativeTokenSet> = Object.create(null);
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath));
      if (parsed && typeof parsed === 'object') Object.assign(entries, parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return entries;
  };
  const update = (change: (entries: Record<string, NativeTokenSet>) => void): Promise<void> => {
    const next = (fileUpdates.get(fileKey) ?? Promise.resolve()).then(async () => {
      const entries = await read();
      change(entries);
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      const tempPath = `${filePath}.${base64urlEncode(randomBytes(6))}.tmp`;
      try {
        await writeFile(tempPath, JSON.stringify(entries, null, 2), { mode: 0o600 });
        await rename(tempPath, filePath);
      } catch (error) {
        // The name is this attempt's own, so whatever is there is a partial write of it.
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
    });
    const settled = next.catch(() => undefined);
    fileUpdates.set(fileKey, settled);
    void settled.then(() => {
      if (fileUpdates.get(fileKey) === settled) fileUpdates.delete(fileKey);
    });
    return next;
  };
  return {
    get: async (key) => {
      await fileUpdates.get(fileKey);
      return (await read())[key];
    },
    set: (key, tokens) => update((entries) => void (entries[key] = tokens)),
    delete: (key) => update((entries) => void delete entries[key]),
  };
}
