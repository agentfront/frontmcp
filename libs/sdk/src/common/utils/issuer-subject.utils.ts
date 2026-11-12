import { base64urlEncode } from '@frontmcp/utils';

/** The issuer of the caller's verified token (its `iss` claim), or '' when the token names none. */
export function resolveIssuer(authInfo: Partial<Record<string, unknown>> | undefined): string {
  const user = asRecord(authInfo?.['user']) ?? asRecord(asRecord(authInfo?.['extra'])?.['user']);
  const issuer = user?.['iss'];
  return typeof issuer === 'string' ? issuer : '';
}

/**
 * A caller as one string, since a subject is unique only within its issuer: `<issuer in base64url>:<subject>`, a valid
 * session id; the subject alone for a token without an issuer, as releases up to 1.12.0 keyed every caller.
 */
export function issuerSubjectKey(issuer: string, subject: string): string {
  return issuer ? `${base64urlEncode(new TextEncoder().encode(issuer))}:${subject}` : subject;
}

/** The value as a plain record, or undefined when it is not an object. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}
