import { resolveToolVisibility, type ToolVisibility } from '../tool.metadata';

describe('resolveToolVisibility', () => {
  it('defaults to public when no flags set', () => {
    expect(resolveToolVisibility({})).toBe<ToolVisibility>('public');
  });

  it('returns explicit visibility when set', () => {
    expect(resolveToolVisibility({ visibility: 'public' })).toBe('public');
    expect(resolveToolVisibility({ visibility: 'hidden' })).toBe('hidden');
    expect(resolveToolVisibility({ visibility: 'internal' })).toBe('internal');
  });

  it('treats deprecated hideFromDiscovery=true as hidden', () => {
    expect(resolveToolVisibility({ hideFromDiscovery: true })).toBe('hidden');
  });

  it('treats hideFromDiscovery=false as public', () => {
    expect(resolveToolVisibility({ hideFromDiscovery: false })).toBe('public');
  });

  it('explicit visibility wins over hideFromDiscovery alias', () => {
    expect(resolveToolVisibility({ visibility: 'internal', hideFromDiscovery: true })).toBe('internal');
    expect(resolveToolVisibility({ visibility: 'public', hideFromDiscovery: true })).toBe('public');
  });
});
