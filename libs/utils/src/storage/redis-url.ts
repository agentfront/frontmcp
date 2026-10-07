/**
 * Connection fields that may be written beside a Redis `url`.
 */
export interface RedisUrlSiblingFields {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: boolean;
}

/**
 * What a `redis://` or `rediss://` URL states, read as ioredis reads it: the userinfo, port and path
 * first, then the same names in its query. An empty username or password counts as left out.
 */
export interface RedisUrlConnection {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  db?: number;
  tls: boolean;
  /** The query's other options, which ioredis takes as they are (`family` as a number). */
  queryOptions: Record<string, string | number>;
}

/**
 * Outcome of combining a Redis URL with the fields written beside it.
 */
export interface RedisUrlMerge {
  /** What the URL states. */
  connection: RedisUrlConnection;
  /** Fields the URL leaves out that the sibling fields supply. */
  fillIns: Pick<RedisUrlSiblingFields, 'port' | 'password' | 'db' | 'tls'>;
  /** Sibling fields whose value contradicts the URL. */
  conflicts: Array<keyof RedisUrlSiblingFields>;
}

function decodeOrRaw(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function integerOrUndefined(text: string | undefined): number | undefined {
  const value = Number.parseInt(text ?? '', 10);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Read a `redis://` or `rediss://` URL. Returns `undefined` for an unparseable URL or another
 * scheme (such as a socket path), which only ioredis reads.
 */
export function readRedisUrl(rawUrl: string): RedisUrlConnection | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return undefined;

  const query: Partial<Record<string, string>> = Object.fromEntries(url.searchParams);
  const { host, port, username, password, db, ...otherOptions } = query;
  const queryOptions: RedisUrlConnection['queryOptions'] = {};
  for (const [name, value = ''] of Object.entries(otherOptions)) {
    queryOptions[name] = name === 'family' ? (integerOrUndefined(value) ?? value) : value;
  }
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1') || host,
    port: integerOrUndefined(url.port || port),
    username: decodeOrRaw(url.username) || username || undefined,
    password: decodeOrRaw(url.password) || password || undefined,
    db: integerOrUndefined(url.pathname.replace(/^\/+/, '') || db),
    tls: url.protocol === 'rediss:',
    queryOptions,
  };
}

/**
 * The URL is the base: fields beside it fill in only what it leaves out (a
 * port, a password, a database, TLS), and a field that contradicts what it
 * states, in its userinfo, path or query, is a conflict the caller must reject
 * (#768). Returns `undefined` for a URL {@link readRedisUrl} cannot read, which
 * the caller reports on its own terms.
 */
export function mergeRedisUrlFields(rawUrl: string, fields: RedisUrlSiblingFields): RedisUrlMerge | undefined {
  const connection = readRedisUrl(rawUrl);
  if (!connection) return undefined;

  const fillIns: RedisUrlMerge['fillIns'] = {};
  const conflicts: RedisUrlMerge['conflicts'] = [];

  if (fields.host !== undefined && fields.host !== connection.host) conflicts.push('host');

  if (fields.port !== undefined) {
    if (connection.port === undefined) fillIns.port = fields.port;
    else if (fields.port !== connection.port) conflicts.push('port');
  }
  if (fields.password !== undefined) {
    if (connection.password === undefined) fillIns.password = fields.password;
    else if (fields.password !== connection.password) conflicts.push('password');
  }
  if (fields.db !== undefined) {
    if (connection.db === undefined) fillIns.db = fields.db;
    else if (fields.db !== connection.db) conflicts.push('db');
  }
  if (fields.tls === true && !connection.tls) fillIns.tls = true;
  if (fields.tls === false && connection.tls) conflicts.push('tls');

  return { connection, fillIns, conflicts };
}

/** Human-readable reason for {@link RedisUrlMerge.conflicts}. */
export function describeRedisUrlConflicts(conflicts: RedisUrlMerge['conflicts']): string {
  return (
    `redis ${conflicts.join(', ')} contradict${conflicts.length === 1 ? 's' : ''} redis.url. ` +
    'Fields beside a url only fill in what the URL leaves out (port, password, db, tls); ' +
    'put the value in the URL or drop the field.'
  );
}
