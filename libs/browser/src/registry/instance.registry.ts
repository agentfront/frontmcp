// file: libs/browser/src/registry/instance.registry.ts
/**
 * Component Instance Registry
 *
 * Tracks component instances with lifecycle management, state per instance,
 * and cleanup on destroy.
 *
 * @example Basic usage
 * ```typescript
 * import { ComponentInstanceRegistry, createInstanceRegistry } from '@frontmcp/browser';
 *
 * const registry = createInstanceRegistry();
 *
 * // Create an instance
 * const instance = registry.create('Button', {
 *   props: { label: 'Click me', variant: 'primary' },
 * });
 *
 * // Update instance state
 * registry.setState(instance.id, { clicked: true });
 *
 * // Get instance
 * const retrieved = registry.get(instance.id);
 *
 * // Destroy instance
 * registry.destroy(instance.id);
 * ```
 */

import { generateUUID } from '@frontmcp/sdk/core';
import { EventBus, EventType, createEventBus, type InstanceEvent } from '../events';

/**
 * Component instance state
 */
export interface ComponentInstance<TProps = Record<string, unknown>, TState = Record<string, unknown>> {
  /** Unique instance ID */
  id: string;
  /** Component name */
  componentName: string;
  /** Instance props */
  props: TProps;
  /** Instance state */
  state: TState;
  /** Parent instance ID (for nested components) */
  parentId?: string;
  /** Child instance IDs */
  children: string[];
  /** Creation timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
  /** DOM element ID (if rendered) */
  elementId?: string;
  /** Instance metadata */
  metadata: Record<string, unknown>;
  /** Whether instance is mounted */
  mounted: boolean;
}

/**
 * Instance creation options
 */
export interface CreateInstanceOptions<TProps = Record<string, unknown>, TState = Record<string, unknown>> {
  /** Initial props */
  props?: TProps;
  /** Initial state */
  state?: TState;
  /** Parent instance ID */
  parentId?: string;
  /** DOM element ID */
  elementId?: string;
  /** Instance metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Instance query options
 */
export interface InstanceQueryOptions {
  /** Filter by component name */
  componentName?: string;
  /** Filter by parent ID */
  parentId?: string;
  /** Filter by mounted state */
  mounted?: boolean;
  /** Filter by metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Component Instance Registry options
 */
export interface InstanceRegistryOptions {
  /** Event bus for instance events */
  eventBus?: EventBus;
  /** Enable debug logging */
  debug?: boolean;
  /** Maximum instances (0 = unlimited) */
  maxInstances?: number;
}

/**
 * Component Instance Registry
 */
export class ComponentInstanceRegistry {
  private instances = new Map<string, ComponentInstance>();
  private byComponent = new Map<string, Set<string>>();
  private byParent = new Map<string, Set<string>>();
  private readonly eventBus: EventBus;
  private readonly debug: boolean;
  private readonly maxInstances: number;

  constructor(options: InstanceRegistryOptions = {}) {
    this.eventBus = options.eventBus ?? createEventBus();
    this.debug = options.debug ?? false;
    this.maxInstances = options.maxInstances ?? 0;
  }

  /**
   * Get the event bus
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Create a new component instance
   */
  create<TProps = Record<string, unknown>, TState = Record<string, unknown>>(
    componentName: string,
    options: CreateInstanceOptions<TProps, TState> = {},
  ): ComponentInstance<TProps, TState> {
    if (this.maxInstances > 0 && this.instances.size >= this.maxInstances) {
      throw new Error(`Maximum instances (${this.maxInstances}) reached`);
    }

    const id = generateUUID();
    const now = Date.now();

    const instance: ComponentInstance<TProps, TState> = {
      id,
      componentName,
      props: options.props ?? ({} as TProps),
      state: options.state ?? ({} as TState),
      parentId: options.parentId,
      children: [],
      createdAt: now,
      updatedAt: now,
      elementId: options.elementId,
      metadata: options.metadata ?? {},
      mounted: false,
    };

    // Store instance
    this.instances.set(id, instance as ComponentInstance);

    // Index by component name
    let componentSet = this.byComponent.get(componentName);
    if (!componentSet) {
      componentSet = new Set();
      this.byComponent.set(componentName, componentSet);
    }
    componentSet.add(id);

    // Index by parent
    if (options.parentId) {
      let parentSet = this.byParent.get(options.parentId);
      if (!parentSet) {
        parentSet = new Set();
        this.byParent.set(options.parentId, parentSet);
      }
      parentSet.add(id);

      // Add to parent's children
      const parent = this.instances.get(options.parentId);
      if (parent) {
        parent.children.push(id);
      }
    }

    // Emit event
    this.emitEvent(EventType.INSTANCE_CREATED, instance as ComponentInstance);

    if (this.debug) {
      console.debug(`[InstanceRegistry] Created instance "${id}" of "${componentName}"`);
    }

    return instance;
  }

  /**
   * Get an instance by ID
   */
  get<TProps = Record<string, unknown>, TState = Record<string, unknown>>(
    id: string,
  ): ComponentInstance<TProps, TState> | undefined {
    return this.instances.get(id) as ComponentInstance<TProps, TState> | undefined;
  }

  /**
   * Check if an instance exists
   */
  has(id: string): boolean {
    return this.instances.has(id);
  }

  /**
   * Get all instances
   */
  getAll(): ComponentInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Query instances
   */
  query(options: InstanceQueryOptions = {}): ComponentInstance[] {
    let results: ComponentInstance[] = [];

    if (options.componentName) {
      const ids = this.byComponent.get(options.componentName);
      if (ids) {
        results = Array.from(ids)
          .map((id) => this.instances.get(id)!)
          .filter(Boolean);
      }
    } else if (options.parentId) {
      const ids = this.byParent.get(options.parentId);
      if (ids) {
        results = Array.from(ids)
          .map((id) => this.instances.get(id)!)
          .filter(Boolean);
      }
    } else {
      results = Array.from(this.instances.values());
    }

    // Apply additional filters
    if (options.mounted !== undefined) {
      results = results.filter((i) => i.mounted === options.mounted);
    }

    if (options.metadata) {
      results = results.filter((i) => {
        for (const [key, value] of Object.entries(options.metadata!)) {
          if (i.metadata[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    return results;
  }

  /**
   * Get instances by component name
   */
  getByComponent(componentName: string): ComponentInstance[] {
    return this.query({ componentName });
  }

  /**
   * Get children of an instance
   */
  getChildren(parentId: string): ComponentInstance[] {
    return this.query({ parentId });
  }

  /**
   * Update instance props
   */
  setProps<TProps = Record<string, unknown>>(id: string, props: Partial<TProps>): boolean {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    const previousState = { ...instance.state };
    instance.props = { ...instance.props, ...props };
    instance.updatedAt = Date.now();

    this.emitEvent(EventType.INSTANCE_STATE_CHANGED, instance, previousState);

    return true;
  }

  /**
   * Update instance state
   */
  setState<TState = Record<string, unknown>>(id: string, state: Partial<TState>): boolean {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    const previousState = { ...instance.state };
    instance.state = { ...instance.state, ...state };
    instance.updatedAt = Date.now();

    this.emitEvent(EventType.INSTANCE_STATE_CHANGED, instance, previousState);

    if (this.debug) {
      console.debug(`[InstanceRegistry] Updated state for "${id}"`, { previousState, newState: instance.state });
    }

    return true;
  }

  /**
   * Replace instance state entirely
   */
  replaceState<TState = Record<string, unknown>>(id: string, state: TState): boolean {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    const previousState = { ...instance.state };
    instance.state = state as Record<string, unknown>;
    instance.updatedAt = Date.now();

    this.emitEvent(EventType.INSTANCE_STATE_CHANGED, instance, previousState);

    return true;
  }

  /**
   * Update instance metadata
   */
  setMetadata(id: string, metadata: Record<string, unknown>): boolean {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    instance.metadata = { ...instance.metadata, ...metadata };
    instance.updatedAt = Date.now();

    return true;
  }

  /**
   * Mark instance as mounted
   */
  mount(id: string, elementId?: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    instance.mounted = true;
    instance.updatedAt = Date.now();
    if (elementId) {
      instance.elementId = elementId;
    }

    this.eventBus.emit(EventType.COMPONENT_MOUNTED, {
      instanceId: id,
      componentName: instance.componentName,
    });

    return true;
  }

  /**
   * Mark instance as unmounted
   */
  unmount(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    instance.mounted = false;
    instance.updatedAt = Date.now();

    this.eventBus.emit(EventType.COMPONENT_UNMOUNTED, {
      instanceId: id,
      componentName: instance.componentName,
    });

    return true;
  }

  /**
   * Destroy an instance and its children
   */
  destroy(id: string, recursive = true): boolean {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    // Recursively destroy children first
    if (recursive && instance.children.length > 0) {
      for (const childId of [...instance.children]) {
        this.destroy(childId, true);
      }
    }

    // Emit event before removal
    this.emitEvent(EventType.INSTANCE_DESTROYED, instance);

    // Remove from parent's children
    if (instance.parentId) {
      const parent = this.instances.get(instance.parentId);
      if (parent) {
        const childIndex = parent.children.indexOf(id);
        if (childIndex >= 0) {
          parent.children.splice(childIndex, 1);
        }
      }
    }

    // Remove from indices
    const componentSet = this.byComponent.get(instance.componentName);
    if (componentSet) {
      componentSet.delete(id);
      if (componentSet.size === 0) {
        this.byComponent.delete(instance.componentName);
      }
    }

    if (instance.parentId) {
      const parentSet = this.byParent.get(instance.parentId);
      if (parentSet) {
        parentSet.delete(id);
        if (parentSet.size === 0) {
          this.byParent.delete(instance.parentId);
        }
      }
    }

    this.byParent.delete(id);

    // Remove instance
    this.instances.delete(id);

    if (this.debug) {
      console.debug(`[InstanceRegistry] Destroyed instance "${id}"`);
    }

    return true;
  }

  /**
   * Clear all instances
   */
  clear(): void {
    // Emit destroy events for all instances
    for (const instance of this.instances.values()) {
      this.emitEvent(EventType.INSTANCE_DESTROYED, instance);
    }

    this.instances.clear();
    this.byComponent.clear();
    this.byParent.clear();

    if (this.debug) {
      console.debug('[InstanceRegistry] Cleared all instances');
    }
  }

  /**
   * Get instance count
   */
  get size(): number {
    return this.instances.size;
  }

  /**
   * Get component names with instances
   */
  getComponentNames(): string[] {
    return Array.from(this.byComponent.keys());
  }

  /**
   * Get instance count by component
   */
  getCountByComponent(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [name, ids] of this.byComponent) {
      counts.set(name, ids.size);
    }
    return counts;
  }

  /**
   * Subscribe to instance events
   */
  onInstanceCreated(handler: (instance: ComponentInstance) => void): () => void {
    return this.eventBus.on(EventType.INSTANCE_CREATED, (event) => {
      const instance = this.instances.get((event as InstanceEvent).instanceId);
      if (instance) {
        handler(instance);
      }
    });
  }

  /**
   * Subscribe to instance destroyed events
   */
  onInstanceDestroyed(handler: (instanceId: string, componentName: string) => void): () => void {
    return this.eventBus.on(EventType.INSTANCE_DESTROYED, (event) => {
      const e = event as InstanceEvent;
      handler(e.instanceId, e.componentName);
    });
  }

  /**
   * Subscribe to instance state changes
   */
  onStateChanged(
    handler: (instanceId: string, newState: Record<string, unknown>, previousState: Record<string, unknown>) => void,
  ): () => void {
    return this.eventBus.on(EventType.INSTANCE_STATE_CHANGED, (event) => {
      const e = event as InstanceEvent;
      handler(e.instanceId, e.newState ?? {}, e.previousState ?? {});
    });
  }

  /**
   * Emit instance event
   */
  private emitEvent(type: EventType, instance: ComponentInstance, previousState?: Record<string, unknown>): void {
    this.eventBus.emit<InstanceEvent>(type, {
      instanceId: instance.id,
      componentName: instance.componentName,
      previousState,
      newState: instance.state,
    });
  }

  /**
   * Convert to JSON representation
   */
  toJSON(): Array<{
    id: string;
    componentName: string;
    props: Record<string, unknown>;
    state: Record<string, unknown>;
    parentId?: string;
    childCount: number;
    mounted: boolean;
    createdAt: number;
    updatedAt: number;
  }> {
    return Array.from(this.instances.values()).map((instance) => ({
      id: instance.id,
      componentName: instance.componentName,
      props: instance.props,
      state: instance.state,
      parentId: instance.parentId,
      childCount: instance.children.length,
      mounted: instance.mounted,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    }));
  }
}

/**
 * Create a new instance registry
 */
export function createInstanceRegistry(options?: InstanceRegistryOptions): ComponentInstanceRegistry {
  return new ComponentInstanceRegistry(options);
}
