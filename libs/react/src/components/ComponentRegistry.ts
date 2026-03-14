/**
 * ComponentRegistry — maps URI protocols to React components.
 *
 * Supported URI protocols:
 * - `component://` — custom React components
 * - `element://`   — reusable UI elements
 * - `page://`      — full page components
 */

import type { ComponentType } from 'react';

export interface ComponentRegistryEntry {
  uri: string;
  name: string;
  component: ComponentType<Record<string, unknown>>;
  description?: string;
}

export class ComponentRegistry {
  private readonly entries = new Map<string, ComponentRegistryEntry>();

  register(uri: string, component: ComponentType<Record<string, unknown>>, meta?: { description?: string }): void {
    const name = extractName(uri);
    this.entries.set(uri, { uri, name, component, description: meta?.description });
  }

  registerAll(map: Record<string, ComponentType<Record<string, unknown>>>): void {
    for (const [uri, component] of Object.entries(map)) {
      this.register(uri, component);
    }
  }

  get(uri: string): ComponentType<Record<string, unknown>> | undefined {
    return this.entries.get(uri)?.component;
  }

  /**
   * Resolve a shorthand name like `'UserCard'` by trying
   * `component://UserCard`, `element://UserCard`, `page://UserCard`.
   */
  resolve(type: string): ComponentType<Record<string, unknown>> | undefined {
    // Exact match first
    const exact = this.entries.get(type);
    if (exact) return exact.component;

    // Try common protocols
    for (const protocol of ['component://', 'element://', 'page://']) {
      const entry = this.entries.get(`${protocol}${type}`);
      if (entry) return entry.component;
    }

    return undefined;
  }

  has(uri: string): boolean {
    return this.entries.has(uri);
  }

  list(): Array<{ uri: string; name: string; description?: string }> {
    return Array.from(this.entries.values()).map(({ uri, name, description }) => ({
      uri,
      name,
      description,
    }));
  }

  clear(): void {
    this.entries.clear();
  }
}

function extractName(uri: string): string {
  const idx = uri.indexOf('://');
  return idx >= 0 ? uri.slice(idx + 3) : uri;
}
