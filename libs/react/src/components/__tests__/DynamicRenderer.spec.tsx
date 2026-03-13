import React from 'react';
import { render } from '@testing-library/react';
import { DynamicRenderer } from '../DynamicRenderer';
import { ComponentRegistry } from '../ComponentRegistry';
import type { ComponentNode } from '../../types';

describe('DynamicRenderer', () => {
  let registry: ComponentRegistry;

  beforeEach(() => {
    registry = new ComponentRegistry();
  });

  it('renders a simple node with string children', () => {
    const tree: ComponentNode = { type: 'span', children: 'Hello World' };

    const { container } = render(<DynamicRenderer tree={tree} registry={registry} />);

    // Falls back to 'div' since 'span' is not in registry and no fallback
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.textContent).toBe('Hello World');
  });

  it('renders a nested node tree', () => {
    const tree: ComponentNode = {
      type: 'wrapper',
      children: {
        type: 'inner',
        children: 'nested text',
      },
    };

    const { container } = render(<DynamicRenderer tree={tree} registry={registry} />);

    const outer = container.firstElementChild!;
    expect(outer.tagName).toBe('DIV');
    const inner = outer.firstElementChild!;
    expect(inner.tagName).toBe('DIV');
    expect(inner.textContent).toBe('nested text');
  });

  it('resolves type from registry', () => {
    const CustomCard = (props: Record<string, unknown>) =>
      React.createElement('section', props, props['children'] as React.ReactNode);

    registry.register('component://Card', CustomCard);

    const tree: ComponentNode = { type: 'Card', children: 'Card content' };

    const { container } = render(<DynamicRenderer tree={tree} registry={registry} />);

    const el = container.firstElementChild!;
    expect(el.tagName).toBe('SECTION');
    expect(el.textContent).toBe('Card content');
  });

  it('uses fallback when type is not found in registry', () => {
    const Fallback = (props: Record<string, unknown>) =>
      React.createElement('article', props, props['children'] as React.ReactNode);

    const tree: ComponentNode = { type: 'Unknown', children: 'fallback content' };

    const { container } = render(<DynamicRenderer tree={tree} registry={registry} fallback={Fallback} />);

    const el = container.firstElementChild!;
    expect(el.tagName).toBe('ARTICLE');
    expect(el.textContent).toBe('fallback content');
  });

  it('defaults to div when no fallback is provided', () => {
    const tree: ComponentNode = { type: 'MissingComponent' };

    const { container } = render(<DynamicRenderer tree={tree} registry={registry} />);

    const el = container.firstElementChild!;
    expect(el.tagName).toBe('DIV');
  });

  it('renders array children', () => {
    const tree: ComponentNode = {
      type: 'list',
      children: [
        { type: 'item', children: 'first' },
        { type: 'item', children: 'second' },
        { type: 'item', children: 'third' },
      ],
    };

    const { container } = render(<DynamicRenderer tree={tree} registry={registry} />);

    const parent = container.firstElementChild!;
    expect(parent.children).toHaveLength(3);
    expect(parent.children[0].textContent).toBe('first');
    expect(parent.children[1].textContent).toBe('second');
    expect(parent.children[2].textContent).toBe('third');
  });

  it('handles null children', () => {
    const tree: ComponentNode = {
      type: 'empty',
      children: null as unknown as undefined,
    };

    const { container } = render(<DynamicRenderer tree={tree} registry={registry} />);

    const el = container.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.childNodes).toHaveLength(0);
  });

  it('handles undefined children', () => {
    const tree: ComponentNode = {
      type: 'empty',
      children: undefined,
    };

    const { container } = render(<DynamicRenderer tree={tree} registry={registry} />);

    const el = container.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.childNodes).toHaveLength(0);
  });

  it('passes props to rendered component', () => {
    const tree: ComponentNode = {
      type: 'widget',
      props: { 'data-testid': 'my-widget', className: 'fancy' },
      children: 'content',
    };

    const { getByTestId } = render(<DynamicRenderer tree={tree} registry={registry} />);

    const el = getByTestId('my-widget');
    expect(el.className).toBe('fancy');
    expect(el.textContent).toBe('content');
  });

  it('renders single ComponentNode child (not array, not string)', () => {
    const tree: ComponentNode = {
      type: 'parent',
      children: { type: 'child', children: 'only child' },
    };

    const { container } = render(<DynamicRenderer tree={tree} registry={registry} />);

    const parent = container.firstElementChild!;
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].textContent).toBe('only child');
  });
});
