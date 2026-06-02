/**
 * normalizeToolAuthProviders — turns the raw `authProviders` metadata (a mix of
 * string shorthand and `{ name, required?, scopes?, alias? }` objects) into a
 * uniform list with defaults applied. The "default required = true" contract is
 * the single source of truth the call-tool credential gate depends on, so it is
 * pinned here.
 */
import { normalizeToolAuthProviders } from '../tool.metadata';

describe('normalizeToolAuthProviders', () => {
  it('returns [] for non-array / undefined input', () => {
    expect(normalizeToolAuthProviders(undefined)).toEqual([]);
    expect(normalizeToolAuthProviders(null)).toEqual([]);
    expect(normalizeToolAuthProviders('github')).toEqual([]);
    expect(normalizeToolAuthProviders({})).toEqual([]);
  });

  it('expands string shorthand to required:true with alias = name', () => {
    expect(normalizeToolAuthProviders(['github'])).toEqual([{ name: 'github', required: true, alias: 'github' }]);
  });

  it('defaults required to true when the object omits it', () => {
    expect(normalizeToolAuthProviders([{ name: 'github' }])).toEqual([
      { name: 'github', required: true, alias: 'github' },
    ]);
  });

  it('preserves an explicit required:false', () => {
    expect(normalizeToolAuthProviders([{ name: 'aws', required: false }])).toEqual([
      { name: 'aws', required: false, alias: 'aws' },
    ]);
  });

  it('keeps scopes and a custom alias', () => {
    expect(
      normalizeToolAuthProviders([{ name: 'github', required: true, scopes: ['repo', 'workflow'], alias: 'gh' }]),
    ).toEqual([{ name: 'github', required: true, alias: 'gh', scopes: ['repo', 'workflow'] }]);
  });

  it('drops empty scopes arrays and non-string scope entries', () => {
    expect(normalizeToolAuthProviders([{ name: 'github', scopes: [] }])).toEqual([
      { name: 'github', required: true, alias: 'github' },
    ]);
    const out = normalizeToolAuthProviders([{ name: 'github', scopes: ['repo', 123, null] }]);
    expect(out[0].scopes).toEqual(['repo']);
  });

  it('skips invalid entries (empty string, missing/blank name)', () => {
    expect(normalizeToolAuthProviders(['', { name: '' }, { required: true }, 42, null])).toEqual([]);
  });

  it('normalizes a mixed list preserving order', () => {
    expect(normalizeToolAuthProviders(['github', { name: 'aws', required: false, alias: 'cloud' }])).toEqual([
      { name: 'github', required: true, alias: 'github' },
      { name: 'aws', required: false, alias: 'cloud' },
    ]);
  });
});
