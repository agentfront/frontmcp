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
  private listeners = new Set<Listener>();
  private version = 0;

  /**
   * Register a dynamic tool. Returns an unregister function
   * suitable for useEffect cleanup.
   */
  registerTool(def: DynamicToolDef): () => void {
    this.tools.set(def.name, def);
    this.notify();
    return () => this.unregisterTool(def.name);
  }

  unregisterTool(name: string): void {
    if (this.tools.delete(name)) {
      this.notify();
    }
  }

  /**
   * Register a dynamic resource. Returns an unregister function
   * suitable for useEffect cleanup.
   */
  registerResource(def: DynamicResourceDef): () => void {
    this.resources.set(def.uri, def);
    this.notify();
    return () => this.unregisterResource(def.uri);
  }

  unregisterResource(uri: string): void {
    if (this.resources.delete(uri)) {
      this.notify();
    }
  }

  /** Update the execute function for an existing tool (for stale closure prevention). */
  updateToolExecute(name: string, execute: DynamicToolDef['execute']): void {
    const existing = this.tools.get(name);
    if (existing) {
      existing.execute = execute;
    }
  }

  /** Update the read function for an existing resource. */
  updateResourceRead(uri: string, read: DynamicResourceDef['read']): void {
    const existing = this.resources.get(uri);
    if (existing) {
      existing.read = read;
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
    this.tools.clear();
    this.resources.clear();
    this.notify();
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}
