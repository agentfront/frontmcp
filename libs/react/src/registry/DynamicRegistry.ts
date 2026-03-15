/**
 * DynamicRegistry — React-side registry for tools and resources that
 * components register on mount and unregister on unmount.
 *
 * Operates as an overlay on the base DirectMcpServer: dynamic entries
 * are merged into listTools/listResources and checked first on
 * callTool/readResource.
 *
 * Uses the same listener/version pattern as ServerRegistry for
 * useSyncExternalStore compatibility.
 */

import type { DynamicToolDef, DynamicResourceDef } from '../types';

type Listener = () => void;

export class DynamicRegistry {
  private tools = new Map<string, DynamicToolDef>();
  private resources = new Map<string, DynamicResourceDef>();
  private toolRefCounts = new Map<string, number>();
  private resourceRefCounts = new Map<string, number>();
  private listeners = new Set<Listener>();
  private version = 0;

  /**
   * Register a dynamic tool. Returns an unregister function
   * suitable for useEffect cleanup.
   *
   * Multiple registrations of the same name are ref-counted:
   * subsequent registrations update the definition but the tool
   * is only removed when every registrant has unregistered.
   */
  registerTool(def: DynamicToolDef): () => void {
    const existing = this.toolRefCounts.get(def.name) ?? 0;
    this.toolRefCounts.set(def.name, existing + 1);
    this.tools.set(def.name, def);
    if (existing === 0) {
      this.notify();
    }
    let called = false;
    return () => {
      if (called) return;
      called = true;
      this.unregisterTool(def.name);
    };
  }

  unregisterTool(name: string): void {
    const count = this.toolRefCounts.get(name);
    if (count == null) return;
    if (count <= 1) {
      this.toolRefCounts.delete(name);
      this.tools.delete(name);
      this.notify();
    } else {
      this.toolRefCounts.set(name, count - 1);
    }
  }

  /**
   * Register a dynamic resource. Returns an unregister function
   * suitable for useEffect cleanup.
   *
   * Multiple registrations of the same URI are ref-counted.
   */
  registerResource(def: DynamicResourceDef): () => void {
    const existing = this.resourceRefCounts.get(def.uri) ?? 0;
    this.resourceRefCounts.set(def.uri, existing + 1);
    this.resources.set(def.uri, def);
    if (existing === 0) {
      this.notify();
    }
    let called = false;
    return () => {
      if (called) return;
      called = true;
      this.unregisterResource(def.uri);
    };
  }

  unregisterResource(uri: string): void {
    const count = this.resourceRefCounts.get(uri);
    if (count == null) return;
    if (count <= 1) {
      this.resourceRefCounts.delete(uri);
      this.resources.delete(uri);
      this.notify();
    } else {
      this.resourceRefCounts.set(uri, count - 1);
    }
  }

  /** Update the execute function for an existing tool (for stale closure prevention). */
  updateToolExecute(name: string, execute: DynamicToolDef['execute']): void {
    const existing = this.tools.get(name);
    if (existing) {
      existing.execute = execute;
    }
  }

  /** Update the read function for an existing resource and notify subscribers. */
  updateResourceRead(uri: string, read: DynamicResourceDef['read']): void {
    const existing = this.resources.get(uri);
    if (existing) {
      existing.read = read;
      this.notify();
    }
  }

  getTools(): DynamicToolDef[] {
    return [...this.tools.values()];
  }

  getResources(): DynamicResourceDef[] {
    return [...this.resources.values()];
  }

  findTool(name: string): DynamicToolDef | undefined {
    return this.tools.get(name);
  }

  findResource(uri: string): DynamicResourceDef | undefined {
    return this.resources.get(uri);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  hasResource(uri: string): boolean {
    return this.resources.has(uri);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
  }

  clear(): void {
    if (this.tools.size === 0 && this.resources.size === 0) return;
    this.tools.clear();
    this.resources.clear();
    this.toolRefCounts.clear();
    this.resourceRefCounts.clear();
    this.notify();
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach((l) => {
      l();
    });
  }
}
