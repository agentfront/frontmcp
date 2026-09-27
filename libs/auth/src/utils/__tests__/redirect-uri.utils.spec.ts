import { isLoopbackRedirectUri } from '../redirect-uri.utils';

describe('isLoopbackRedirectUri', () => {
  it.each([
    'http://localhost:3000/cb',
    'http://127.0.0.1/cb',
    'http://127.12.0.9:8080/cb',
    'http://[::1]:5555/cb',
    'https://localhost/cb',
  ])('accepts %s', (uri) => {
    expect(isLoopbackRedirectUri(uri)).toBe(true);
  });

  it.each([
    'https://attacker.example.net/cb',
    'http://localhost.evil.com/cb',
    'http://127.0.0.1.evil.com/cb',
    'http://127.0.0.1@evil.com/cb',
    'http://user:pw@localhost/cb',
    'http://128.0.0.1/cb',
    'http://999.0.0.1/cb',
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s', (uri) => {
    expect(isLoopbackRedirectUri(uri)).toBe(false);
  });
});
