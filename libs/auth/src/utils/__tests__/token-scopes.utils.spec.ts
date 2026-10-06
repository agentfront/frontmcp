import { scopesFromClaims } from '../token-scopes.utils';

describe('scopesFromClaims', () => {
  it('reads a space-delimited scope string', () => {
    expect(scopesFromClaims({ scope: 'tickets:read  tickets:write' })).toEqual(['tickets:read', 'tickets:write']);
  });

  it('reads an scp claim as an array or a string', () => {
    expect(scopesFromClaims({ scp: ['tickets:read', 7, 'tickets:write'] })).toEqual(['tickets:read', 'tickets:write']);
    expect(scopesFromClaims({ scp: 'tickets:read' })).toEqual(['tickets:read']);
  });

  it('merges scope and scp without duplicates', () => {
    expect(scopesFromClaims({ scope: 'a b', scp: ['b', 'c'] })).toEqual(['a', 'b', 'c']);
  });

  it('answers no scopes for missing or malformed claims', () => {
    expect(scopesFromClaims(undefined)).toEqual([]);
    expect(scopesFromClaims({ scope: 42, scp: { a: 1 } })).toEqual([]);
  });
});
