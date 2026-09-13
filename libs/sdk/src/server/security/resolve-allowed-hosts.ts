/**
 * Default `allowedHosts` derivation for DNS-rebinding protection
 * (GHSA-mc9g-v2cp-vfff).
 *
 * Protection is on by default, which is only workable if the default allow-list
 * is right without configuration. It is derived from what the server actually
 * binds: the names a client can legitimately use to reach *this* process.
 */

/** Loopback spellings a local client may use, in `Host`-header form. */
const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'];

export interface DeriveAllowedHostsInput {
  /** Resolved bind address (e.g. '127.0.0.1', '0.0.0.0', '::'). */
  bindAddress?: string;
  /** Listening TCP port, when the server listens on one. */
  port?: number;
  /** Unix socket path — when set there is no TCP host to derive. */
  socketPath?: string;
  /** Configured issuer / public URL, so a deployed server keeps working. */
  issuer?: string;
  /** Extra hosts from `FRONTMCP_ALLOWED_HOSTS`. */
  extraHosts?: string[];
}

/**
 * Canonicalize an IP literal or hostname.
 *
 * IPv6 has many spellings of one address — `::1`, `0:0:0:0:0:0:0:1` and
 * `0000:...:0001` are the same loopback — so a textual compare misses most of
 * them. `URL` canonicalizes them; a hostname passes through lowercased.
 */
function canonicalizeAddress(address: string): string {
  const bare = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!bare.includes(':')) return bare;
  try {
    return new URL(`http://[${bare}]`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return bare;
  }
}

/**
 * True when the address only accepts connections from this machine.
 *
 * Classifying a loopback listener as routable would disable the derived
 * DNS-rebinding allow-list on exactly the server the attack targets, so every
 * spelling of loopback has to resolve here.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = canonicalizeAddress(address);
  return (
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('127.') ||
    // IPv4-mapped IPv6 loopback, which `URL` renders as `::ffff:7f00:1`.
    normalized === '::ffff:7f00:1' ||
    normalized.startsWith('::ffff:127.')
  );
}

/** Both `host` and `host:port` — `Host` omits the port on 80/443. */
function withAndWithoutPort(host: string, port?: number): string[] {
  return port ? [host, `${host}:${port}`] : [host];
}

/** Extract the `Host`-header form of a URL, ignoring anything unparseable. */
function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when the bind address means "reachable from the network".
 *
 * A wildcard bind, or a specific non-loopback NIC, is a deployed server: the
 * names clients dial it by (a DNS name behind a proxy, a load-balancer host)
 * are not knowable from inside the process.
 */
export function isRoutableBind(address: string | undefined): boolean {
  if (!address) return false;
  return !isLoopbackAddress(address);
}

/**
 * Derive the hosts a request may legitimately name.
 *
 * A loopback-bound server is only reachable as a loopback name, so the derived
 * list is exact and can be enforced as-is — which is precisely the DNS-rebinding
 * threat model (the attacker rebinds a domain to the victim's 127.0.0.1).
 *
 * A server bound to a routable address is reached by names this process cannot
 * enumerate. `deriveAllowedHosts` returns what it can (the loopback aliases, the
 * bound NIC, the issuer host); the caller decides whether that is enough to
 * enforce — see {@link shouldEnforceDerivedHosts}.
 */
export function deriveAllowedHosts(input: DeriveAllowedHostsInput): string[] {
  const hosts = new Set<string>();

  // A Unix-socket server has no TCP host at all; the socket's filesystem
  // permissions are the boundary, and clients send an arbitrary placeholder
  // Host. Returning an empty list disables host checking for that transport.
  if (input.socketPath) return [];

  for (const name of LOOPBACK_NAMES) {
    for (const value of withAndWithoutPort(name, input.port)) hosts.add(value);
  }

  const bindAddress = input.bindAddress?.trim();
  if (bindAddress && !isLoopbackAddress(bindAddress) && bindAddress !== '0.0.0.0' && bindAddress !== '::') {
    // A specific NIC address is itself a name a client can dial.
    const literal = bindAddress.includes(':') && !bindAddress.startsWith('[') ? `[${bindAddress}]` : bindAddress;
    for (const value of withAndWithoutPort(literal, input.port)) hosts.add(value);
  }

  const issuerHost = hostFromUrl(input.issuer);
  if (issuerHost) {
    hosts.add(issuerHost);
    // An issuer URL usually elides the default port; a proxied request may still
    // carry it, so accept both spellings.
    const [name] = issuerHost.split(':');
    if (!issuerHost.includes(':') && input.port) hosts.add(`${name}:${input.port}`);
  }

  for (const extra of input.extraHosts ?? []) {
    const trimmed = extra.trim();
    if (trimmed) hosts.add(trimmed);
  }

  return [...hosts];
}

/**
 * Whether a DERIVED (not operator-supplied) host list may be enforced.
 *
 * Enforcing a derived list on a routable bind would 403 every request that
 * arrives under the deployment's real hostname — a proxied server upgrading a
 * patch version would go dark. So a derived list is enforced only when the
 * server is loopback-bound, or when the operator gave us a public name to add
 * (an issuer URL or FRONTMCP_ALLOWED_HOSTS). Otherwise the caller should warn
 * and leave Host checking off until `allowedHosts` is configured.
 */
export function shouldEnforceDerivedHosts(input: DeriveAllowedHostsInput): boolean {
  if (input.socketPath) return false;

  // Only a USABLE public name counts. An unparseable issuer would otherwise
  // flip enforcement on while `deriveAllowedHosts` drops it, leaving a list of
  // loopback hosts that 403s every request arriving on the real hostname.
  const hasExplicitName = hostFromUrl(input.issuer) !== undefined || (input.extraHosts ?? []).some((h) => h.trim());
  if (hasExplicitName) return true;

  // Without a known port the derived list cannot match a real `Host` header
  // (which carries one for every non-default port), so there is nothing usable
  // to enforce. A host that constructs the adapter without telling it what it
  // listens on gets no derived enforcement rather than a list that rejects
  // everything.
  if (input.port === undefined) return false;

  return !isRoutableBind(input.bindAddress);
}

/** Parse the `FRONTMCP_ALLOWED_HOSTS` escape hatch (comma-separated). */
export function allowedHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const raw = env['FRONTMCP_ALLOWED_HOSTS']?.trim();
  if (!raw) return undefined;
  const hosts = raw
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : undefined;
}
