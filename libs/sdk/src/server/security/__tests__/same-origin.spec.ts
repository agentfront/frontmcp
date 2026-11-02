import { isSameOriginRequest } from '../same-origin';

describe('isSameOriginRequest', () => {
  it('allows a request with no Origin and no Sec-Fetch-Site (a CLI or agent client)', () => {
    expect(isSameOriginRequest({ host: 'localhost:3000' })).toBe(true);
  });

  it.each([
    ['its own Origin', { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }],
    ['its own Origin on a default port', { host: 'example.com:80', origin: 'http://example.com' }],
    [
      'another loopback spelling on the same port',
      { host: '127.0.0.1:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' },
    ],
    ['Sec-Fetch-Site: same-origin', { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' }],
    ['Sec-Fetch-Site: none (typed in the address bar)', { host: 'localhost:3000', 'sec-fetch-site': 'none' }],
  ])('allows %s', (_case, headers) => {
    expect(isSameOriginRequest(headers)).toBe(true);
  });

  it.each([
    ['another site', { host: 'localhost:3000', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
    ['another site that hides Sec-Fetch-Site', { host: 'localhost:3000', origin: 'https://evil.example' }],
    ['another port of the same loopback host', { host: 'localhost:3000', origin: 'http://localhost:4000' }],
    ['a null Origin (a sandboxed frame)', { host: 'localhost:3000', origin: 'null' }],
    ['Sec-Fetch-Site: cross-site without an Origin', { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site: same-site (a sibling subdomain)', { host: 'api.example.com', 'sec-fetch-site': 'same-site' }],
    [
      'its own Origin marked cross-site',
      { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' },
    ],
    ['a loopback Origin on a routable host', { host: 'app.example.com', origin: 'http://localhost' }],
  ])('refuses %s', (_case, headers) => {
    expect(isSameOriginRequest(headers)).toBe(false);
  });

  it('allows the Origin a trusted proxy forwarded for', () => {
    const headers = { host: '10.0.0.5:3000', 'x-forwarded-host': 'app.example.com', origin: 'https://app.example.com' };

    expect(isSameOriginRequest(headers, [], true)).toBe(true);
  });

  it('refuses an X-Forwarded-Host the page set itself, when no proxy is trusted', () => {
    const headers = { host: 'api.example.com', 'x-forwarded-host': 'evil.example', origin: 'https://evil.example' };

    expect(isSameOriginRequest(headers)).toBe(false);
  });

  it('allows an Origin the server lists, from another site', () => {
    const headers = { host: 'localhost:3000', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-site' };

    expect(isSameOriginRequest(headers, ['http://LOCALHOST:5173/'])).toBe(true);
  });

  it('reads the first value of a repeated header', () => {
    expect(
      isSameOriginRequest({ host: 'localhost:3000', origin: ['https://evil.example', 'http://localhost:3000'] }),
    ).toBe(false);
  });
});
