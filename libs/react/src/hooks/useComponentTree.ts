/**
 * useComponentTree — exposes the DOM subtree under a ref as an MCP resource.
 *
 * Uses `data-component` attributes for component names (opt-in).
 * Falls back to tag names for unattributed elements.
 * Returns a JSON tree structure representing the component hierarchy.
 */

import { useCallback } from 'react';
import type { RefObject } from 'react';
import type { ReadResourceResult } from '@frontmcp/sdk';
import { useDynamicResource } from './useDynamicResource';

/** RFC 3986 scheme pattern: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) "://" */
const RFC_3986_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export interface UseComponentTreeOptions {
  rootRef: RefObject<HTMLElement | null>;
  /** Resource URI (defaults to 'react://component-tree'). */
  uri?: string;
  /** Maximum traversal depth (default: 10). */
  maxDepth?: number;
  /** Include data-* attributes as props (default: false). */
  includeProps?: boolean;
  /** Target a specific named server. */
  server?: string;
}

interface TreeNode {
  component: string;
  tag: string;
  children: TreeNode[];
  props?: Record<string, string>;
}

function walkDom(element: Element, maxDepth: number, includeProps: boolean, depth = 0): TreeNode | null {
  if (depth > maxDepth) return null;

  const component = element.getAttribute('data-component') ?? undefined;
  const tag = element.tagName.toLowerCase();

  const children: TreeNode[] = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = walkDom(element.children[i], maxDepth, includeProps, depth + 1);
    if (child) children.push(child);
  }

  const node: TreeNode = {
    component: component ?? tag,
    tag,
    children,
  };

  if (includeProps) {
    const props: Record<string, string> = {};
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      if (attr.name.startsWith('data-') && attr.name !== 'data-component') {
        props[attr.name] = attr.value;
      }
    }
    if (Object.keys(props).length > 0) {
      node.props = props;
    }
  }

  return node;
}

export function useComponentTree(options: UseComponentTreeOptions): void {
  const { rootRef, uri = 'react://component-tree', maxDepth = 10, includeProps = false, server } = options;

  if (!RFC_3986_SCHEME_RE.test(uri)) {
    throw new Error('URI must have a valid scheme (e.g., file://, https://, custom://)');
  }

  const read = useCallback(async (): Promise<ReadResourceResult> => {
    const root = rootRef.current;
    if (!root) {
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ error: 'Root element not mounted' }) }],
      };
    }

    const tree = walkDom(root, maxDepth, includeProps);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(tree) }],
    };
  }, [rootRef, uri, maxDepth, includeProps]);

  useDynamicResource({
    uri,
    name: 'component-tree',
    description: 'React component tree (DOM-based with data-component attributes)',
    mimeType: 'application/json',
    read,
    server,
  });
}
