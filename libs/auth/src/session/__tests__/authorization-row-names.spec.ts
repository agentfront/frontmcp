import { AuthorizationRowNames } from '../authorization-row-names';

describe('AuthorizationRowNames', () => {
  // Fixed vectors: a change to the derivation renames every stored row, and signs every user out.
  it('names a row by HMAC-SHA256 under a key HKDF derives from the secret', () => {
    expect(new AuthorizationRowNames('a-stable-secret-of-at-least-32-bytes').name('refresh-token-value')).toBe(
      'Jcf7JBzyq8-e0Vf_YB3lOGwyNs20xdrA6Gd4hELgsB8',
    );
  });

  it('names a row under a fixed key without a secret, the same in every process', () => {
    expect(new AuthorizationRowNames().name('refresh-token-value')).toBe('LCg-PN2265p_hZyDBinWh9437Mdniq7_acw77gVsW4Q');
    expect(new AuthorizationRowNames('').name('refresh-token-value')).toBe(
      'LCg-PN2265p_hZyDBinWh9437Mdniq7_acw77gVsW4Q',
    );
  });

  it('names a row the same from a secret and from its bytes', () => {
    const secret = 'a-stable-secret-of-at-least-32-bytes';
    expect(new AuthorizationRowNames(new TextEncoder().encode(secret)).name('code')).toBe(
      new AuthorizationRowNames(secret).name('code'),
    );
  });

  it('names a row differently under another secret, and never by the value', () => {
    const value = 'refresh-token-value';
    const names = [
      new AuthorizationRowNames('secret-one').name(value),
      new AuthorizationRowNames('secret-two').name(value),
    ];
    expect(new Set(names).size).toBe(2);
    for (const name of names) expect(name).not.toContain(value);
  });
});
