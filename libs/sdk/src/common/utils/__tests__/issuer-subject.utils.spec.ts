import { SESSION_ID_VALID_PATTERN } from '../../../context/frontmcp-context';
import { issuerSubjectKey, resolveIssuer } from '../issuer-subject.utils';

describe('resolveIssuer', () => {
  it('reads the issuer of the claims at the top level or under extra.user', () => {
    expect(resolveIssuer({ user: { iss: 'https://a.example', sub: 'u' } })).toBe('https://a.example');
    expect(resolveIssuer({ extra: { user: { iss: 'https://a.example', sub: 'u' } } })).toBe('https://a.example');
  });

  it('is empty when the token names no issuer', () => {
    expect(resolveIssuer({ user: { sub: 'u' } })).toBe('');
    expect(resolveIssuer(undefined)).toBe('');
  });
});

describe('issuerSubjectKey', () => {
  it('joins the issuer, in base64url, and the subject', () => {
    expect(issuerSubjectKey('https://a.example', 'user-1')).toBe('aHR0cHM6Ly9hLmV4YW1wbGU:user-1');
  });

  it('gives two issuers with the same subject two keys', () => {
    expect(issuerSubjectKey('https://a.example', 'user-1')).not.toBe(issuerSubjectKey('https://b.example', 'user-1'));
  });

  it('never gives two pairs one key when a part holds a colon', () => {
    expect(issuerSubjectKey('a', 'b:c')).not.toBe(issuerSubjectKey('a:b', 'c'));
  });

  it('keeps to the characters a session id allows', () => {
    expect(issuerSubjectKey('https://a.example/tenant?x=1', 'user-1')).toMatch(SESSION_ID_VALID_PATTERN);
  });

  it('is the subject alone, as up to 1.12.0, for a token without an issuer', () => {
    expect(issuerSubjectKey('', 'user-1')).toBe('user-1');
  });
});
