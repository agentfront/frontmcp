/**
 * DynamicRegistry — React-side registry for tools and resources that
 * components register on mount and unregister on unmount.
 *
 * Tools are mirrored into the server as real tools by `bindDynamicTools`
 * (the provider binds each server's registry), so they run through the
 * server's flows. Resources stay an overlay on the base DirectMcpServer:
 * they are merged into listResources and checked first on readResource.
 *
 * Uses the same listener/version pattern as ServerRegistry for
 * useSyncExternalStore compatibility.
 */

import type { DynamicResourceDef, DynamicToolDef } from '../types';

type Listener = () => void;

export class DynamicRegistry {
  private tools = new Map<string, DynamicToolDef>();
  private resources = new Map<string, DynamicResourceDef>();
  /** Every live registration of a tool name, oldest first; the newest one is the definition in use. */
  private toolRegistrations = new Map<string, DynamicToolDef[]>();
  private resourceRefCounts = new Map<string, number>();
  private listeners = new Set<Listener>();
  private resourceListeners = new Set<(uri: string) => void>();
  private version = 0;

  /**
   * Register a dynamic tool. Returns an unregister function
   * suitable for useEffect cleanup.
   *
   * Multiple registrations of the same name are ref-counted:
   * subsequent registrations replace the definition (and notify, so
   * the server registration follows the new description, schema or
   * availability) but the tool is only removed when every registrant
   * has unregistered. When the registrant whose definition is in use
   * unregisters, the newest remaining registration takes over, so a
   * call never reaches an unmounted component's `execute`.
   */
  registerTool(def: DynamicToolDef): () => void {
    const registrations = this.toolRegistrations.get(def.name) ?? [];
    registrations.push(def);
    this.toolRegistrations.set(def.name, registrations);
    this.tools.set(def.name, def);
    this.notify();
    let called = false;
    return () => {
      if (called) return;
      called = true;
      this.removeToolRegistration(def);
    };
  }

  /** Drop the oldest registration of `name` (registrants should call the function `registerTool` returned). */
  unregisterTool(name: string): void {
    const oldest = this.toolRegistrations.get(name)?.[0];
    if (oldest) this.removeToolRegistration(oldest);
  }

  private removeToolRegistration(def: DynamicToolDef): void {
    const registrations = this.toolRegistrations.get(def.name);
    const index = registrations?.lastIndexOf(def) ?? -1;
    if (!registrations || index === -1) return;
    registrations.splice(index, 1);
    const newest = registrations[registrations.length - 1];
    if (!newest) {
      this.toolRegistrations.delete(def.name);
      this.tools.delete(def.name);
      this.notify();
    } else if (this.tools.get(def.name) !== newest) {
      this.tools.set(def.name, newest);
      this.notify();
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
      this.resourceListeners.forEach((l) => {
        l(uri);
      });
    }
  }

  /** Listen for changes to a dynamic resource's content (the in-page `resources/updated`). */
  onResourceUpdated(listener: (uri: string) => void): () => void {
    this.resourceListeners.add(listener);
    return () => {
      this.resourceListeners.delete(listener);
    };
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
    this.toolRegistrations.clear();
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
