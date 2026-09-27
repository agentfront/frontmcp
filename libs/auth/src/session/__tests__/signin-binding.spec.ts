import { sha256Hex } from '@frontmcp/utils';

import {
  createSigninBinding,
  SIGNIN_BINDING_COOKIE_PREFIX,
  signinBindingCookieName,
  signinBindingMatches,
} from '../signin-binding';

describe('sign-in binding', () => {
  it('names the cookie after the pending authorization, without carrying its id', () => {
    const name = signinBindingCookieName('pending-1');

    expect(name).toMatch(new RegExp(`^${SIGNIN_BINDING_COOKIE_PREFIX}[0-9a-f]{16}$`));
    expect(name).not.toContain('pending-1');
    expect(signinBindingCookieName('pending-1')).toBe(name);
    expect(signinBindingCookieName('pending-2')).not.toBe(name);
  });

  it('creates a random value and keeps only its hash', () => {
    const first = createSigninBinding('pending-1');
    const second = createSigninBinding('pending-1');

    expect(first.cookieName).toBe(signinBindingCookieName('pending-1'));
    expect(first.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hash).toBe(sha256Hex(first.value));
    expect(second.value).not.toBe(first.value);
  });

  it('matches the cookie of the browser that holds the binding, among others', () => {
    const binding = createSigninBinding('pending-1');
    const other = createSigninBinding('pending-2');
    const header = `theme=dark; ${other.cookieName}=${other.value}; ${binding.cookieName}=${binding.value}`;

    expect(signinBindingMatches(header, 'pending-1', binding.hash)).toBe(true);
    expect(signinBindingMatches(header, 'pending-2', other.hash)).toBe(true);
  });

  it.each([
    ['no Cookie header', undefined],
    ['no cookie for this sign-in', 'theme=dark'],
    ['another value', `${signinBindingCookieName('pending-1')}=${'A'.repeat(43)}`],
  ])('refuses %s', (_label, header) => {
    const binding = createSigninBinding('pending-1');

    expect(signinBindingMatches(header, 'pending-1', binding.hash)).toBe(false);
  });

  it("refuses another sign-in's cookie", () => {
    const binding = createSigninBinding('pending-1');
    const other = createSigninBinding('pending-2');

    expect(signinBindingMatches(`${other.cookieName}=${other.value}`, 'pending-1', binding.hash)).toBe(false);
  });

  it('refuses everything for a record without a binding', () => {
    const binding = createSigninBinding('pending-1');

    expect(signinBindingMatches(`${binding.cookieName}=${binding.value}`, 'pending-1', undefined)).toBe(false);
  });
});
