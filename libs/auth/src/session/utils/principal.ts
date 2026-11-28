/**
 * Who a token speaks for: a person who signed in, or a machine (an OAuth client acting for itself), told apart from
 * the token's claims, and how a server says so itself where its identity provider marks machines another way.
 */

/** `'person'`: a person signed in. `'machine'`: a client acting for itself. `'anonymous'`: no one signed in. */
export type PrincipalKind = 'person' | 'machine' | 'anonymous';

/** The caller a request's token speaks for. */
export interface AuthPrincipal {
  readonly kind: PrincipalKind;
  /** The token's subject: `sub`, else `client_id`, else `azp`; empty for an anonymous caller. */
  readonly sub: string;
  /** The OAuth client the token was issued to: `client_id`, else `azp`, else `cid`. */
  readonly clientId?: string;
  /** When the caller authenticated, in epoch seconds: `auth_time` (when the person signed in), else `iat`. */
  readonly authTime?: number;
  /** How the token was obtained, when it says (`client_credentials` from Auth0's `gty`). */
  readonly grantType?: string;
}

/**
 * Decides the principal of a verified token, for an identity provider that marks machines another way: it gets the
 * token's claims and the principal FrontMCP detected, and returns the fields to change (`{ kind: 'machine' }`), or
 * `undefined` to keep the detected one. It may be async. One that throws, or answers a `kind` that is not one of
 * the three, leaves the detected principal.
 */
export type PrincipalResolver = (
  claims: Readonly<Record<string, unknown>>,
  detected: AuthPrincipal,
) => Partial<AuthPrincipal> | undefined | Promise<Partial<AuthPrincipal> | undefined>;

const PRINCIPAL_KINDS: ReadonlySet<string> = new Set(['person', 'machine', 'anonymous']);

/** `gty` values (Auth0) that name the client-credentials grant. */
const CLIENT_CREDENTIALS_GRANTS: ReadonlySet<string> = new Set(['client-credentials', 'client_credentials']);

function stringClaim(claims: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = claims[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberClaim(claims: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = claims[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Whether `value` is a principal: a known kind and a string subject. */
export function isAuthPrincipal(value: unknown): value is AuthPrincipal {
  const candidate = value as Partial<AuthPrincipal> | null | undefined;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.kind === 'string' &&
    PRINCIPAL_KINDS.has(candidate.kind) &&
    typeof candidate.sub === 'string'
  );
}

/** The fields of a principal, without anything else a resolver answered. */
function principalFields(value: Partial<AuthPrincipal>): Partial<AuthPrincipal> {
  const { kind, sub, clientId, authTime, grantType } = value;
  return {
    kind,
    sub,
    ...(clientId !== undefined ? { clientId } : {}),
    ...(authTime !== undefined ? { authTime } : {}),
    ...(grantType !== undefined ? { grantType } : {}),
  };
}

/**
 * The principal a token's claims name. A machine when the token says it was issued by the client-credentials grant
 * (`gty`), when Microsoft Entra marks an app token (`idtyp: 'app'`), or when its subject is the client it was issued
 * to (`sub` equal to `client_id`, `azp`, `cid` or `appid`, as RFC 9068 §2.2 has it for a client acting for itself,
 * and as it is when the token has no `sub`). Anonymous when its subject is missing, empty or `anon:…`. A person
 * otherwise.
 */
export function detectPrincipal(claims: Readonly<Record<string, unknown>>): AuthPrincipal {
  const sub = stringClaim(claims, 'sub') ?? stringClaim(claims, 'client_id') ?? stringClaim(claims, 'azp') ?? '';
  const clientId = stringClaim(claims, 'client_id') ?? stringClaim(claims, 'azp') ?? stringClaim(claims, 'cid');
  const authTime = numberClaim(claims, 'auth_time') ?? numberClaim(claims, 'iat');
  const gty = stringClaim(claims, 'gty');
  const grantType = gty && CLIENT_CREDENTIALS_GRANTS.has(gty) ? 'client_credentials' : gty;
  const details = {
    sub,
    ...(clientId !== undefined ? { clientId } : {}),
    ...(authTime !== undefined ? { authTime } : {}),
    ...(grantType !== undefined ? { grantType } : {}),
  };
  if (sub === '' || sub.startsWith('anon:')) return { kind: 'anonymous', ...details };
  const subjectIsClient = ['client_id', 'azp', 'cid', 'appid'].some((key) => stringClaim(claims, key) === sub);
  const machine = grantType === 'client_credentials' || claims['idtyp'] === 'app' || subjectIsClient;
  return { kind: machine ? 'machine' : 'person', ...details };
}

/**
 * The principal of a token: the one {@link detectPrincipal} finds, with the fields `resolver` changes. A resolver
 * that throws, or answers what a principal cannot hold, leaves the detected principal and is reported to `onError`.
 */
export async function resolvePrincipal(
  claims: Readonly<Record<string, unknown>>,
  resolver?: PrincipalResolver,
  onError?: (message: string) => void,
): Promise<AuthPrincipal> {
  const detected = detectPrincipal(claims);
  if (!resolver) return detected;
  try {
    const changes = await resolver(claims, detected);
    if (changes === undefined) return detected;
    const resolved = principalFields({ ...detected, ...changes });
    if (isAuthPrincipal(resolved)) return resolved;
    onError?.(`The principal resolver answered a principal FrontMCP cannot use (kind "${String(resolved.kind)}")`);
  } catch (error) {
    onError?.(`The principal resolver failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return detected;
}
