import { applyPrimitiveFilter } from '../primitive-filter';
import type { AppFilterConfig } from '../../metadata/app-filter.metadata';

describe('applyPrimitiveFilter()', () => {
  const items = [
    { name: 'echo' },
    { name: 'add' },
    { name: 'dangerous-delete' },
    { name: 'dangerous-format' },
    { name: 'search' },
  ];

  describe('default: include (default mode)', () => {
    it('returns all items when no config', () => {
      expect(applyPrimitiveFilter(items, 'tools')).toEqual(items);
    });

    it('returns all items when config is undefined', () => {
      expect(applyPrimitiveFilter(items, 'tools', undefined)).toEqual(items);
    });

    it('returns all items when config has no patterns for this type', () => {
      const config: AppFilterConfig = { exclude: { resources: ['*'] } };
      expect(applyPrimitiveFilter(items, 'tools', config)).toEqual(items);
    });

    it('excludes items matching exclude patterns', () => {
      const config: AppFilterConfig = { exclude: { tools: ['echo'] } };
      const result = applyPrimitiveFilter(items, 'tools', config);
      expect(result.map((i) => i.name)).toEqual(['add', 'dangerous-delete', 'dangerous-format', 'search']);
    });

    it('supports glob patterns (dangerous-*)', () => {
      const config: AppFilterConfig = { exclude: { tools: ['dangerous-*'] } };
      const result = applyPrimitiveFilter(items, 'tools', config);
      expect(result.map((i) => i.name)).toEqual(['echo', 'add', 'search']);
    });

    it('supports exact name match', () => {
      const config: AppFilterConfig = { exclude: { tools: ['add'] } };
      const result = applyPrimitiveFilter(items, 'tools', config);
      expect(result).not.toContainEqual({ name: 'add' });
      expect(result).toHaveLength(4);
    });

    it('exclude takes precedence over include when both match', () => {
      const config: AppFilterConfig = {
        include: { tools: ['echo'] },
        exclude: { tools: ['echo'] },
      };
      const result = applyPrimitiveFilter(items, 'tools', config);
      expect(result.map((i) => i.name)).not.toContain('echo');
    });
  });

  describe('default: exclude', () => {
    it('returns empty when no include patterns for this type', () => {
      const config: AppFilterConfig = { default: 'exclude' };
      expect(applyPrimitiveFilter(items, 'tools', config)).toEqual([]);
    });

    it('includes only items matching include patterns', () => {
      const config: AppFilterConfig = {
        default: 'exclude',
        include: { tools: ['echo', 'add'] },
      };
      const result = applyPrimitiveFilter(items, 'tools', config);
      expect(result.map((i) => i.name)).toEqual(['echo', 'add']);
    });

    it('supports glob patterns in include', () => {
      const config: AppFilterConfig = {
        default: 'exclude',
        include: { tools: ['dangerous-*'] },
      };
      const result = applyPrimitiveFilter(items, 'tools', config);
      expect(result.map((i) => i.name)).toEqual(['dangerous-delete', 'dangerous-format']);
    });

    it('include takes precedence over exclude when both match', () => {
      const config: AppFilterConfig = {
        default: 'exclude',
        include: { tools: ['echo'] },
        exclude: { tools: ['echo'] },
      };
      const result = applyPrimitiveFilter(items, 'tools', config);
      expect(result.map((i) => i.name)).toContain('echo');
    });
  });

  describe('edge cases', () => {
    it('empty items array returns empty', () => {
      const config: AppFilterConfig = { exclude: { tools: ['echo'] } };
      expect(applyPrimitiveFilter([], 'tools', config)).toEqual([]);
    });

    it('undefined config returns all items', () => {
      expect(applyPrimitiveFilter(items, 'tools', undefined)).toEqual(items);
    });

    it('wildcard * matches everything in exclude', () => {
      const config: AppFilterConfig = { exclude: { tools: ['*'] } };
      expect(applyPrimitiveFilter(items, 'tools', config)).toEqual([]);
    });

    it('wildcard * matches everything in include', () => {
      const config: AppFilterConfig = {
        default: 'exclude',
        include: { tools: ['*'] },
      };
      expect(applyPrimitiveFilter(items, 'tools', config)).toEqual(items);
    });

    it('patterns with special regex chars are handled properly', () => {
      const specialItems = [{ name: 'tool.v2' }, { name: 'tool-v2' }, { name: 'toollv2' }];
      const config: AppFilterConfig = {
        default: 'exclude',
        include: { tools: ['tool.v2'] },
      };
      const result = applyPrimitiveFilter(specialItems, 'tools', config);
      // Only exact match, dot is escaped
      expect(result.map((i) => i.name)).toEqual(['tool.v2']);
    });

    it('works with different primitive types', () => {
      const config: AppFilterConfig = { exclude: { resources: ['echo'] } };
      const result = applyPrimitiveFilter(items, 'resources', config);
      expect(result).toHaveLength(4);
    });

    it('returns empty for exclude-default with no include patterns for the type but other types have patterns', () => {
      const config: AppFilterConfig = {
        default: 'exclude',
        include: { resources: ['config'] },
      };
      expect(applyPrimitiveFilter(items, 'tools', config)).toEqual([]);
    });
  });
});
