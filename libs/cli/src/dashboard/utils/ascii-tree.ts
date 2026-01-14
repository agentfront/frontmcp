/**
 * ASCII Tree Renderer
 *
 * Renders a tree structure using box-drawing characters.
 */

import type { ScopeGraphNode } from '../events/types.js';

// Icons for different node types
const ICONS: Record<ScopeGraphNode['type'], string> = {
  scope: '●',
  app: '◆',
  plugin: '◇',
  tool: '▸',
  resource: '▹',
  prompt: '▻',
  agent: '▪',
};

// Box-drawing characters
const BRANCH = '├── ';
const LAST_BRANCH = '└── ';
const VERTICAL = '│   ';
const SPACE = '    ';

export interface RenderOptions {
  /** Include icons before node names */
  showIcons?: boolean;
  /** Include node type in parentheses */
  showType?: boolean;
  /** Maximum depth to render (0 = unlimited) */
  maxDepth?: number;
  /** Filter nodes by type */
  filterTypes?: ScopeGraphNode['type'][];
  /** Compact mode - single line per node */
  compact?: boolean;
}

/**
 * Render a scope graph as ASCII tree.
 *
 * @example
 * ```
 * ● FrontMcp
 * ├── ◆ PortalApp
 * │   ├── ▸ get_users
 * │   ├── ▸ create_user
 * │   └── ◇ OktaPlugin
 * │       └── ▸ sync_users
 * └── ▹ README.md
 * ```
 */
export function renderAsciiTree(node: ScopeGraphNode, options: RenderOptions = {}): string[] {
  const { showIcons = true, showType = false, maxDepth = 0, filterTypes, compact = false } = options;

  const lines: string[] = [];

  const renderNode = (n: ScopeGraphNode, prefix: string, isLast: boolean, depth: number): void => {
    // Check depth limit
    if (maxDepth > 0 && depth > maxDepth) {
      return;
    }

    // Check type filter
    if (filterTypes && !filterTypes.includes(n.type)) {
      // Still render children in case they match
      const children = n.children || [];
      children.forEach((child, i) => {
        renderNode(child, prefix, i === children.length - 1, depth);
      });
      return;
    }

    // Build node label
    const icon = showIcons ? `${ICONS[n.type] || '○'} ` : '';
    const typeLabel = showType ? ` (${n.type})` : '';
    const label = `${icon}${n.name}${typeLabel}`;

    // Determine connector
    const connector = depth === 0 ? '' : isLast ? LAST_BRANCH : BRANCH;

    // Add line
    lines.push(`${prefix}${connector}${label}`);

    // Render children
    const children = n.children || [];
    const childPrefix = depth === 0 ? '' : prefix + (isLast ? SPACE : VERTICAL);

    children.forEach((child, i) => {
      renderNode(child, childPrefix, i === children.length - 1, depth + 1);
    });
  };

  renderNode(node, '', true, 0);

  return lines;
}

/**
 * Render tree as a single string.
 */
export function renderAsciiTreeString(node: ScopeGraphNode, options: RenderOptions = {}): string {
  return renderAsciiTree(node, options).join('\n');
}

/**
 * Count total nodes in tree.
 */
export function countNodes(node: ScopeGraphNode): number {
  let count = 1;
  for (const child of node.children || []) {
    count += countNodes(child);
  }
  return count;
}

/**
 * Count nodes by type.
 */
export function countNodesByType(node: ScopeGraphNode): Record<ScopeGraphNode['type'], number> {
  const counts: Record<string, number> = {
    scope: 0,
    app: 0,
    plugin: 0,
    tool: 0,
    resource: 0,
    prompt: 0,
    agent: 0,
  };

  const traverse = (n: ScopeGraphNode) => {
    counts[n.type] = (counts[n.type] || 0) + 1;
    for (const child of n.children || []) {
      traverse(child);
    }
  };

  traverse(node);
  return counts as Record<ScopeGraphNode['type'], number>;
}

/**
 * Find a node by ID in the tree.
 */
export function findNodeById(node: ScopeGraphNode, id: string): ScopeGraphNode | undefined {
  if (node.id === id) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findNodeById(child, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Get all nodes of a specific type.
 */
export function getNodesByType(node: ScopeGraphNode, type: ScopeGraphNode['type']): ScopeGraphNode[] {
  const nodes: ScopeGraphNode[] = [];

  const traverse = (n: ScopeGraphNode) => {
    if (n.type === type) {
      nodes.push(n);
    }
    for (const child of n.children || []) {
      traverse(child);
    }
  };

  traverse(node);
  return nodes;
}
