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
 * Outcome of combining a Redis URL with the fields written beside it.
 */
export interface RedisUrlMerge {
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

/**
 * The URL is the base: fields beside it fill in only what it leaves out (a
 * port, a password, a database, TLS), and a field that contradicts it is a
 * conflict the caller must reject (#768). Returns `undefined` for an
 * unparseable URL, which the caller reports on its own terms.
 */
export function mergeRedisUrlFields(rawUrl: string, fields: RedisUrlSiblingFields): RedisUrlMerge | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }

  const urlHost = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const urlPort = url.port ? Number(url.port) : undefined;
  const urlPassword = url.password ? decodeOrRaw(url.password) : undefined;
  const urlDbText = url.pathname.replace(/^\/+/, '') || url.searchParams.get('db') || undefined;
  const urlDb = urlDbText === undefined ? undefined : Number(urlDbText);
  const urlUsesTls = url.protocol === 'rediss:';

  const fillIns: RedisUrlMerge['fillIns'] = {};
  const conflicts: RedisUrlMerge['conflicts'] = [];

  if (fields.host !== undefined && fields.host !== urlHost) conflicts.push('host');

  if (fields.port !== undefined) {
    if (urlPort === undefined) fillIns.port = fields.port;
    else if (fields.port !== urlPort) conflicts.push('port');
  }
  if (fields.password !== undefined) {
    if (urlPassword === undefined) fillIns.password = fields.password;
    else if (fields.password !== urlPassword) conflicts.push('password');
  }
  if (fields.db !== undefined) {
    if (urlDb === undefined) fillIns.db = fields.db;
    else if (fields.db !== urlDb) conflicts.push('db');
  }
  if (fields.tls === true && !urlUsesTls) fillIns.tls = true;
  if (fields.tls === false && urlUsesTls) conflicts.push('tls');

  return { fillIns, conflicts };
}

/** Human-readable reason for {@link RedisUrlMerge.conflicts}. */
export function describeRedisUrlConflicts(conflicts: RedisUrlMerge['conflicts']): string {
  return (
    `redis ${conflicts.join(', ')} contradict${conflicts.length === 1 ? 's' : ''} redis.url. ` +
    'Fields beside a url only fill in what the URL leaves out (port, password, db, tls); ' +
    'put the value in the URL or drop the field.'
  );
}
