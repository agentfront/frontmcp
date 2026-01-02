/**
 * Tests for provider record types.
 */

import { ProviderKind } from '../records/provider.record.js';

describe('ProviderKind', () => {
  it('should have CLASS_TOKEN value', () => {
    expect(ProviderKind.CLASS_TOKEN).toBe('CLASS_TOKEN');
  });

  it('should have CLASS value', () => {
    expect(ProviderKind.CLASS).toBe('CLASS');
  });

  it('should have VALUE value', () => {
    expect(ProviderKind.VALUE).toBe('VALUE');
  });

  it('should have FACTORY value', () => {
    expect(ProviderKind.FACTORY).toBe('FACTORY');
  });

  it('should have INJECTED value', () => {
    expect(ProviderKind.INJECTED).toBe('INJECTED');
  });

  it('should only have 5 kinds', () => {
    const values = Object.values(ProviderKind);
    expect(values).toHaveLength(5);
    expect(values).toEqual(expect.arrayContaining(['CLASS_TOKEN', 'CLASS', 'VALUE', 'FACTORY', 'INJECTED']));
  });
});
