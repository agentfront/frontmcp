import { diffAdded, diffRemoved } from '../diff-remote-capabilities';

describe('diffRemoved', () => {
  it('returns entries in prev but not in next, preserving prev insertion order', () => {
    const prev = new Map<string, string>([
      ['tool-a', 'token-a'],
      ['tool-b', 'token-b'],
      ['tool-c', 'token-c'],
    ]);
    const next = new Map<string, string>([
      ['tool-a', 'token-a-new'],
      ['tool-c', 'token-c-new'],
    ]);
    expect(diffRemoved(prev, next)).toEqual([['tool-b', 'token-b']]);
  });

  it('returns every entry when next is empty', () => {
    const prev = new Map<string, string>([
      ['tool-a', 'token-a'],
      ['tool-b', 'token-b'],
    ]);
    expect(diffRemoved(prev, new Map())).toEqual([
      ['tool-a', 'token-a'],
      ['tool-b', 'token-b'],
    ]);
  });

  it('returns empty when prev is empty (first refresh)', () => {
    const next = new Map<string, string>([['tool-a', 'token-a']]);
    expect(diffRemoved(new Map(), next)).toEqual([]);
  });

  it('returns empty when prev equals next (idempotent refresh)', () => {
    const prev = new Map<string, string>([['tool-a', 'token-a']]);
    const next = new Map<string, string>([['tool-a', 'token-a']]);
    expect(diffRemoved(prev, next)).toEqual([]);
  });

  it('treats different-token-same-key as NOT removed (same qualified name)', () => {
    // If the server minted a new token for the same qualified name, the
    // key is still present in next; diffRemoved reports no removal.
    // Re-registering the entry via registerToolInstance is idempotent
    // on the ORIGINAL token, which may or may not match — rename cases
    // are out of scope for diffRemoved and handled by the caller if at all.
    const prev = new Map<string, string>([['tool-a', 'token-old']]);
    const next = new Map<string, string>([['tool-a', 'token-new']]);
    expect(diffRemoved(prev, next)).toEqual([]);
  });
});

describe('diffAdded', () => {
  it('returns entries in next but not in prev', () => {
    const prev = new Map<string, string>([['tool-a', 'token-a']]);
    const next = new Map<string, string>([
      ['tool-a', 'token-a'],
      ['tool-b', 'token-b'],
    ]);
    expect(diffAdded(prev, next)).toEqual([['tool-b', 'token-b']]);
  });

  it('returns every entry when prev is empty (initial registration)', () => {
    const next = new Map<string, string>([
      ['tool-a', 'token-a'],
      ['tool-b', 'token-b'],
    ]);
    expect(diffAdded(new Map(), next)).toEqual([
      ['tool-a', 'token-a'],
      ['tool-b', 'token-b'],
    ]);
  });

  it('returns empty when next is empty', () => {
    const prev = new Map<string, string>([['tool-a', 'token-a']]);
    expect(diffAdded(prev, new Map())).toEqual([]);
  });
});
