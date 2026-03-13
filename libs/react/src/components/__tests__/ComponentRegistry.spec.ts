import React from 'react';
import { ComponentRegistry } from '../ComponentRegistry';

const MockComponent = (props: Record<string, unknown>) => React.createElement('div', props, 'mock');
const AnotherComponent = (props: Record<string, unknown>) => React.createElement('span', props, 'another');

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry;

  beforeEach(() => {
    registry = new ComponentRegistry();
  });

  describe('register', () => {
    it('registers a component with a uri', () => {
      registry.register('component://Card', MockComponent);

      expect(registry.has('component://Card')).toBe(true);
      expect(registry.get('component://Card')).toBe(MockComponent);
    });

    it('registers with description metadata', () => {
      registry.register('component://Card', MockComponent, { description: 'A card component' });

      const entries = registry.list();
      expect(entries).toHaveLength(1);
      expect(entries[0].description).toBe('A card component');
    });

    it('registers with no description metadata', () => {
      registry.register('component://Card', MockComponent);

      const entries = registry.list();
      expect(entries[0].description).toBeUndefined();
    });
  });

  describe('registerAll', () => {
    it('registers multiple components from a map', () => {
      registry.registerAll({
        'component://Card': MockComponent,
        'element://Button': AnotherComponent,
      });

      expect(registry.has('component://Card')).toBe(true);
      expect(registry.has('element://Button')).toBe(true);
      expect(registry.get('component://Card')).toBe(MockComponent);
      expect(registry.get('element://Button')).toBe(AnotherComponent);
    });
  });

  describe('get', () => {
    it('returns component for an exact uri match', () => {
      registry.register('component://Card', MockComponent);

      expect(registry.get('component://Card')).toBe(MockComponent);
    });

    it('returns undefined for unknown uri', () => {
      expect(registry.get('component://Unknown')).toBeUndefined();
    });
  });

  describe('resolve', () => {
    it('returns component on exact match', () => {
      registry.register('component://Card', MockComponent);

      expect(registry.resolve('component://Card')).toBe(MockComponent);
    });

    it('resolves with component:// prefix', () => {
      registry.register('component://UserCard', MockComponent);

      expect(registry.resolve('UserCard')).toBe(MockComponent);
    });

    it('resolves with element:// prefix', () => {
      registry.register('element://Button', MockComponent);

      expect(registry.resolve('Button')).toBe(MockComponent);
    });

    it('resolves with page:// prefix', () => {
      registry.register('page://Dashboard', MockComponent);

      expect(registry.resolve('Dashboard')).toBe(MockComponent);
    });

    it('prefers exact match over prefix resolution', () => {
      registry.register('CustomWidget', MockComponent);
      registry.register('component://CustomWidget', AnotherComponent);

      expect(registry.resolve('CustomWidget')).toBe(MockComponent);
    });

    it('tries component:// before element:// and page://', () => {
      registry.register('component://Shared', MockComponent);
      registry.register('element://Shared', AnotherComponent);

      expect(registry.resolve('Shared')).toBe(MockComponent);
    });

    it('returns undefined for unknown type', () => {
      expect(registry.resolve('NonExistent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true when uri exists', () => {
      registry.register('component://Card', MockComponent);

      expect(registry.has('component://Card')).toBe(true);
    });

    it('returns false when uri does not exist', () => {
      expect(registry.has('component://Unknown')).toBe(false);
    });
  });

  describe('list', () => {
    it('returns all registered entries', () => {
      registry.register('component://Card', MockComponent, { description: 'Card desc' });
      registry.register('element://Button', AnotherComponent);

      const entries = registry.list();
      expect(entries).toHaveLength(2);
      expect(entries).toEqual([
        { uri: 'component://Card', name: 'Card', description: 'Card desc' },
        { uri: 'element://Button', name: 'Button', description: undefined },
      ]);
    });

    it('returns empty array when no entries', () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('empties the registry', () => {
      registry.register('component://Card', MockComponent);
      registry.register('element://Button', AnotherComponent);
      expect(registry.list()).toHaveLength(2);

      registry.clear();

      expect(registry.list()).toHaveLength(0);
      expect(registry.has('component://Card')).toBe(false);
      expect(registry.has('element://Button')).toBe(false);
    });
  });

  describe('extractName (via register)', () => {
    it('strips component:// protocol', () => {
      registry.register('component://UserCard', MockComponent);

      const entries = registry.list();
      expect(entries[0].name).toBe('UserCard');
    });

    it('strips element:// protocol', () => {
      registry.register('element://IconButton', MockComponent);

      const entries = registry.list();
      expect(entries[0].name).toBe('IconButton');
    });

    it('strips page:// protocol', () => {
      registry.register('page://Settings', MockComponent);

      const entries = registry.list();
      expect(entries[0].name).toBe('Settings');
    });

    it('returns full string when no protocol present', () => {
      registry.register('PlainName', MockComponent);

      const entries = registry.list();
      expect(entries[0].name).toBe('PlainName');
    });

    it('strips custom protocol', () => {
      registry.register('custom://Widget', MockComponent);

      const entries = registry.list();
      expect(entries[0].name).toBe('Widget');
    });
  });
});
