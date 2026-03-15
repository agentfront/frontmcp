import React from 'react';
import { renderHook } from '@testing-library/react';
import { useComponentTree } from '../useComponentTree';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import type { FrontMcpContextValue } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper(dynamicRegistry: DynamicRegistry) {
  const ctx: FrontMcpContextValue = {
    name: 'test',
    registry: new ComponentRegistry(),
    dynamicRegistry,
    getDynamicRegistry: () => dynamicRegistry,
    connect: async () => {},
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(FrontMcpContext.Provider, { value: ctx }, children);
  };
}

function buildDom(): HTMLElement {
  // <div data-component="App">
  //   <header data-component="Header" data-testid="hdr" data-role="banner">
  //     <span>title</span>
  //   </header>
  //   <main>
  //     <p data-component="Paragraph"></p>
  //   </main>
  // </div>
  const root = document.createElement('div');
  root.setAttribute('data-component', 'App');

  const header = document.createElement('header');
  header.setAttribute('data-component', 'Header');
  header.setAttribute('data-testid', 'hdr');
  header.setAttribute('data-role', 'banner');

  const span = document.createElement('span');
  header.appendChild(span);
  root.appendChild(header);

  const main = document.createElement('main');
  const p = document.createElement('p');
  p.setAttribute('data-component', 'Paragraph');
  main.appendChild(p);
  root.appendChild(main);

  return root;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useComponentTree', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  describe('resource registration', () => {
    it('registers a resource with default uri and metadata', () => {
      const rootRef = { current: document.createElement('div') };

      renderHook(() => useComponentTree({ rootRef }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('react://component-tree')).toBe(true);
      const resource = dynamicRegistry.findResource('react://component-tree');
      expect(resource).toBeDefined();
      expect(resource!.name).toBe('component-tree');
      expect(resource!.description).toBe('React component tree (DOM-based with data-component attributes)');
      expect(resource!.mimeType).toBe('application/json');
    });

    it('registers with a custom uri', () => {
      const rootRef = { current: document.createElement('div') };

      renderHook(() => useComponentTree({ rootRef, uri: 'react://custom-tree' }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('react://custom-tree')).toBe(true);
      expect(dynamicRegistry.hasResource('react://component-tree')).toBe(false);
    });

    it('unregisters resource on unmount', () => {
      const rootRef = { current: document.createElement('div') };

      const { unmount } = renderHook(() => useComponentTree({ rootRef }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('react://component-tree')).toBe(true);
      unmount();
      expect(dynamicRegistry.hasResource('react://component-tree')).toBe(false);
    });
  });

  describe('reading — root not mounted', () => {
    it('returns an error JSON when rootRef.current is null', async () => {
      const rootRef = { current: null };

      renderHook(() => useComponentTree({ rootRef }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('react://component-tree');
      expect(result.contents[0].mimeType).toBe('application/json');

      const parsed = JSON.parse(result.contents[0].text as string);
      expect(parsed).toEqual({ error: 'Root element not mounted' });
    });

    it('uses custom uri in error response when root is null', async () => {
      const rootRef = { current: null };

      renderHook(() => useComponentTree({ rootRef, uri: 'react://my-tree' }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://my-tree')!;
      const result = await resource.read();

      expect(result.contents[0].uri).toBe('react://my-tree');
    });
  });

  describe('DOM walking — basic tree', () => {
    it('serializes a simple DOM tree with data-component attributes', async () => {
      const root = buildDom();
      const rootRef = { current: root };

      renderHook(() => useComponentTree({ rootRef }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      expect(tree.component).toBe('App');
      expect(tree.tag).toBe('div');
      expect(tree.children).toHaveLength(2);

      // header with data-component="Header"
      expect(tree.children[0].component).toBe('Header');
      expect(tree.children[0].tag).toBe('header');
      // span child inside header (no data-component, falls back to tag)
      expect(tree.children[0].children).toHaveLength(1);
      expect(tree.children[0].children[0].component).toBe('span');
      expect(tree.children[0].children[0].tag).toBe('span');

      // main (no data-component, falls back to tag)
      expect(tree.children[1].component).toBe('main');
      expect(tree.children[1].tag).toBe('main');
      // p with data-component="Paragraph"
      expect(tree.children[1].children).toHaveLength(1);
      expect(tree.children[1].children[0].component).toBe('Paragraph');
      expect(tree.children[1].children[0].tag).toBe('p');
    });

    it('does not include props by default', async () => {
      const root = buildDom();
      const rootRef = { current: root };

      renderHook(() => useComponentTree({ rootRef }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      // No props on the root or any child
      expect(tree.props).toBeUndefined();
      expect(tree.children[0].props).toBeUndefined();
    });
  });

  describe('includeProps option', () => {
    it('includes data-* attributes (excluding data-component) as props when enabled', async () => {
      const root = buildDom();
      const rootRef = { current: root };

      renderHook(() => useComponentTree({ rootRef, includeProps: true }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      // Header has data-testid="hdr" and data-role="banner", but NOT data-component
      const header = tree.children[0];
      expect(header.props).toEqual({
        'data-testid': 'hdr',
        'data-role': 'banner',
      });
    });

    it('does not add props key when element has no qualifying data-* attributes', async () => {
      const el = document.createElement('div');
      el.setAttribute('data-component', 'Root');
      // Only has data-component — should be excluded
      const rootRef = { current: el };

      renderHook(() => useComponentTree({ rootRef, includeProps: true }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      expect(tree.props).toBeUndefined();
    });

    it('includes props on elements with non-data-component data attributes only', async () => {
      const el = document.createElement('div');
      el.setAttribute('id', 'main'); // not a data-* attr — excluded
      el.setAttribute('class', 'container'); // not a data-* attr — excluded
      el.setAttribute('data-value', '42'); // qualifies
      const rootRef = { current: el };

      renderHook(() => useComponentTree({ rootRef, includeProps: true }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      expect(tree.props).toEqual({ 'data-value': '42' });
    });
  });

  describe('maxDepth option', () => {
    it('defaults maxDepth to 10 (deep trees traversed)', async () => {
      // Build a chain of 5 nested divs — all within default maxDepth of 10
      let current = document.createElement('div');
      const root = current;
      for (let i = 0; i < 4; i++) {
        const child = document.createElement('div');
        current.appendChild(child);
        current = child;
      }
      const rootRef = { current: root };

      renderHook(() => useComponentTree({ rootRef }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      // Walk down to depth 4
      let node = tree;
      for (let i = 0; i < 4; i++) {
        expect(node.children).toHaveLength(1);
        node = node.children[0];
      }
      expect(node.children).toHaveLength(0);
    });

    it('stops traversal when maxDepth is exceeded', async () => {
      // Build 3-level deep tree, set maxDepth to 1
      const root = document.createElement('div');
      const child = document.createElement('section');
      const grandchild = document.createElement('span');
      child.appendChild(grandchild);
      root.appendChild(child);
      const rootRef = { current: root };

      renderHook(() => useComponentTree({ rootRef, maxDepth: 1 }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      // depth 0 = root (div), depth 1 = child (section) — within limit
      expect(tree.tag).toBe('div');
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].tag).toBe('section');
      // depth 2 = grandchild — exceeds maxDepth of 1, so not included
      expect(tree.children[0].children).toHaveLength(0);
    });

    it('returns root only when maxDepth is 0', async () => {
      const root = document.createElement('div');
      root.appendChild(document.createElement('span'));
      const rootRef = { current: root };

      renderHook(() => useComponentTree({ rootRef, maxDepth: 0 }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      expect(tree.tag).toBe('div');
      expect(tree.children).toHaveLength(0);
    });
  });

  describe('elements without data-component', () => {
    it('uses tag name as component when data-component is absent', async () => {
      const root = document.createElement('article');
      const rootRef = { current: root };

      renderHook(() => useComponentTree({ rootRef }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      expect(tree.component).toBe('article');
      expect(tree.tag).toBe('article');
    });
  });

  describe('empty root', () => {
    it('returns tree with no children for empty root element', async () => {
      const root = document.createElement('div');
      const rootRef = { current: root };

      renderHook(() => useComponentTree({ rootRef }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('react://component-tree')!;
      const result = await resource.read();
      const tree = JSON.parse(result.contents[0].text as string);

      expect(tree.component).toBe('div');
      expect(tree.tag).toBe('div');
      expect(tree.children).toEqual([]);
    });
  });

  describe('server option', () => {
    it('passes server option through to useDynamicResource', () => {
      // The server option is forwarded to useDynamicResource;
      // this test mainly ensures no error is thrown with it set.
      const rootRef = { current: document.createElement('div') };

      renderHook(() => useComponentTree({ rootRef, server: 'my-server' }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('react://component-tree')).toBe(true);
    });
  });
});
