import { classifyIpAddress, isGloballyRoutableIp, parseIpv4 } from './ip-address';

export interface OutboundTargetOptions {
  /** Test-only: also accept `http:` and loopback or private targets. */
  allowLocal?: boolean;
}

export type OutboundUrlProblem = 'malformed' | 'scheme' | 'credentials' | 'host';

export type OutboundUrlCheck = { ok: true; url: URL } | { ok: false; problem: OutboundUrlProblem };

const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);
const METADATA_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.com',
  'metadata.aws.com',
]);

/** Whether a request may connect to an IP address: globally routable, or loopback or private with `allowLocal`. */
export function isAllowedOutboundAddress(address: string, options: OutboundTargetOptions = {}): boolean {
  if (isGloballyRoutableIp(address)) return true;
  const range = classifyIpAddress(address)?.range;
  return options.allowLocal === true && (range === 'loopback' || range === 'private');
}

/** Whether a URL host may be requested: an allowed IP literal, or a name that is neither local nor a metadata service. */
function isAllowedHostname(hostname: string, options: OutboundTargetOptions): boolean {
  const isIpLiteral = hostname.startsWith('[') || parseIpv4(hostname) !== undefined;
  if (isIpLiteral) return isAllowedOutboundAddress(hostname, options);

  const name = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (METADATA_HOSTNAMES.has(name)) return false;
  const isLoopbackName = LOOPBACK_HOSTNAMES.has(name) || name.endsWith('.localhost');
  return !isLoopbackName || options.allowLocal === true;
}

/** Checks a URL a server did not choose before any I/O: `https:`, no credentials, and a host that is not local. */
export function validateOutboundUrl(target: string, options: OutboundTargetOptions = {}): OutboundUrlCheck {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { ok: false, problem: 'malformed' };
  }
  const isAllowedScheme = url.protocol === 'https:' || (url.protocol === 'http:' && options.allowLocal === true);
  if (!isAllowedScheme) return { ok: false, problem: 'scheme' };
  if (url.username !== '' || url.password !== '') return { ok: false, problem: 'credentials' };
  if (!isAllowedHostname(url.hostname, options)) return { ok: false, problem: 'host' };
  return { ok: true, url };
}
