/**
 * Fixture tokens for a gateway-mode server must carry the `iss` and `aud` that
 * server mints (#269). Its issuer includes `http.entryPath`, so a fixture that
 * used the bare server URL as `iss` minted tokens every server with an entry
 * path refused.
 */
import { gatewayTokenBinding } from '../gateway-token-binding';

describe('gatewayTokenBinding', () => {
  it('uses the server URL for a server mounted at the root', () => {
    expect(gatewayTokenBinding('http://localhost:3000')).toEqual({
      issuer: 'http://localhost:3000',
      audience: 'http://localhost:3000',
    });
  });

  it('puts the entry path in the issuer as well as the audience', () => {
    expect(gatewayTokenBinding('http://localhost:3000', '/mcp')).toEqual({
      issuer: 'http://localhost:3000/mcp',
      audience: 'http://localhost:3000/mcp',
    });
  });

  it.each(['mcp', '/mcp/', '//mcp//'])('normalizes the entry path %p as the server does', (entryPath) => {
    expect(gatewayTokenBinding('http://localhost:3000/', entryPath).issuer).toBe('http://localhost:3000/mcp');
  });

  it.each(['', '/'])('treats %p as the root', (entryPath) => {
    expect(gatewayTokenBinding('http://localhost:3000/', entryPath).issuer).toBe('http://localhost:3000');
  });
});
