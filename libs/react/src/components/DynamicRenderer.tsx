/**
 * DynamicRenderer — recursively renders a ComponentNode tree into React elements.
 *
 * Resolution order for `type`:
 * 1. Exact URI match in registry
 * 2. `component://{type}` in registry
 * 3. `element://{type}` in registry
 * 4. Fallback `<div>`
 */

import React from 'react';
import type { ComponentNode } from '../types';
import type { ComponentRegistry } from './ComponentRegistry';

export interface DynamicRendererProps {
  tree: ComponentNode;
  registry: ComponentRegistry;
  fallback?: React.ComponentType<Record<string, unknown>>;
}

export function DynamicRenderer({ tree, registry, fallback }: DynamicRendererProps): React.ReactElement {
  return renderNode(tree, registry, fallback, 0);
}

function renderNode(
  node: ComponentNode,
  registry: ComponentRegistry,
  fallback: React.ComponentType<Record<string, unknown>> | undefined,
  index: number,
): React.ReactElement {
  const Component = registry.resolve(node.type) ?? fallback ?? 'div';

  const childElements = renderChildren(node.children, registry, fallback);

  return React.createElement(
    Component as React.ElementType,
    { ...node.props, key: `dynamic-${index}` },
    ...childElements,
  );
}

function renderChildren(
  children: ComponentNode['children'],
  registry: ComponentRegistry,
  fallback: React.ComponentType<Record<string, unknown>> | undefined,
): Array<React.ReactNode> {
  if (children === undefined || children === null) {
    return [];
  }

  if (typeof children === 'string') {
    return [children];
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => renderNode(child, registry, fallback, i));
  }

  // Single ComponentNode
  return [renderNode(children, registry, fallback, 0)];
}
