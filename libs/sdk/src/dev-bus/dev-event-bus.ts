import { randomUUID } from '@frontmcp/utils';
import type {
  DevEvent,
  SessionEvent,
  RequestEvent,
  RegistryEvent,
  ServerEvent,
  ScopeGraphEvent,
  ScopeGraphNode,
  RequestFlowType,
} from './dev-event.types';
import {
  DevEventBusOptions,
  DevEventBusOptionsInput,
  parseDevEventBusOptions,
  isDevBusEnabled,
} from './dev-event-bus.options';
import type { ToolChangeEvent } from '../tool/tool.events';
import type { ResourceChangeEvent } from '../resource/resource.events';
import type { PromptChangeEvent } from '../prompt/prompt.events';
import type { AgentChangeEvent, AgentChangeScope } from '../agent/agent.events';

export type DevEventListener = (event: DevEvent) => void;

/**
 * Ring buffer for storing events with fixed capacity.
 * Oldest events are automatically dropped when capacity is exceeded.
 */
class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly maxSize: number) {}

  push(item: T): void {
    if (this.items.length >= this.maxSize) {
      this.items.shift();
    }
    this.items.push(item);
  }

  getAll(): readonly T[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }

  get length(): number {
    return this.items.length;
  }
}

/**
 * DevEventBus aggregates SDK events for development dashboard consumption.
 *
 * Features:
 * - Subscribes to existing emitters (Tool, Resource, Prompt, Agent)
 * - Intercepts flow execution via hooks to capture request/response
 * - Buffers events for late subscribers
 * - Supports IPC or stderr transport
 * - Zero overhead when disabled (no subscriptions)
 *
 * @example
 * ```typescript
 * const bus = new DevEventBus({ enabled: true });
 * bus.activate(scope);
 *
 * bus.subscribe((event) => {
 *   console.log(`[${event.type}] ${event.data}`);
 * });
 * ```
 */
export class DevEventBus {
  private readonly listeners = new Set<DevEventListener>();
  private readonly buffer: RingBuffer<DevEvent>;
  private readonly options: DevEventBusOptions;
  private readonly unsubscribers: Array<() => void> = [];
  private isActive = false;
  private scopeId = 'unknown';
  private startTime = Date.now();

  constructor(options?: DevEventBusOptionsInput) {
    this.options = parseDevEventBusOptions(options);
    this.buffer = new RingBuffer(this.options.bufferSize);
  }

  /**
   * Check if the bus is currently active.
   */
  get active(): boolean {
    return this.isActive;
  }

  /**
   * Get the current options.
   */
  getOptions(): DevEventBusOptions {
    return { ...this.options };
  }

  /**
   * Activate the event bus and start collecting events.
   * This should be called during scope initialization.
   *
   * @param scope - The scope to subscribe to for events
   */
  activate(scope: {
    id: string;
    tools: { subscribe: (opts: { immediate: boolean }, listener: (e: ToolChangeEvent) => void) => () => void };
    resources: { subscribe: (opts: { immediate: boolean }, listener: (e: ResourceChangeEvent) => void) => () => void };
    prompts: { subscribe: (opts: { immediate: boolean }, listener: (e: PromptChangeEvent) => void) => () => void };
    agents: { subscribe: (opts: { immediate: boolean }, listener: (e: AgentChangeEvent) => void) => () => void };
    notifications: {
      // We'll emit events when servers are registered/unregistered
    };
  }): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.scopeId = scope.id;
    this.startTime = Date.now();

    // Subscribe to tool changes
    const toolUnsub = scope.tools.subscribe({ immediate: false }, (event) => {
      this.emitRegistryEvent('tool', event.kind, event.changeScope, event.snapshot.length, event.version);
    });
    this.unsubscribers.push(toolUnsub);

    // Subscribe to resource changes
    const resourceUnsub = scope.resources.subscribe({ immediate: false }, (event) => {
      this.emitRegistryEvent('resource', event.kind, event.changeScope, event.snapshot.length, event.version);
    });
    this.unsubscribers.push(resourceUnsub);

    // Subscribe to prompt changes
    const promptUnsub = scope.prompts.subscribe({ immediate: false }, (event) => {
      this.emitRegistryEvent('prompt', event.kind, event.changeScope, event.snapshot.length, event.version);
    });
    this.unsubscribers.push(promptUnsub);

    // Subscribe to agent changes
    // Note: AgentChangeScope includes 'scope' | 'app' | 'plugin' | 'agent', we normalize to 'global' | 'session'
    const agentUnsub = scope.agents.subscribe({ immediate: false }, (event) => {
      const normalizedScope = event.changeScope === 'global' ? 'global' : 'session';
      this.emitRegistryEvent(
        'agent',
        event.kind as 'added' | 'removed' | 'updated' | 'reset',
        normalizedScope,
        event.snapshot.length,
        event.version,
      );
    });
    this.unsubscribers.push(agentUnsub);

    // Emit server starting event
    this.emitServerEvent('server:starting', {});
  }

  /**
   * Deactivate the event bus and clean up subscriptions.
   */
  deactivate(): void {
    if (!this.isActive) {
      return;
    }

    // Emit server shutdown event before deactivating
    this.emitServerEvent('server:shutdown', {
      uptimeMs: Date.now() - this.startTime,
    });

    this.isActive = false;

    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.unsubscribers.length = 0;
  }

  /**
   * Subscribe to events.
   *
   * @param listener - Callback invoked for each event
   * @returns Unsubscribe function
   */
  subscribe(listener: DevEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get all buffered events.
   * Useful for late subscribers to catch up.
   */
  getBuffer(): readonly DevEvent[] {
    return this.buffer.getAll();
  }

  /**
   * Clear the event buffer.
   */
  clearBuffer(): void {
    this.buffer.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public emit methods (called by hooks and adapters)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Emit a session event.
   */
  emitSessionEvent(type: SessionEvent['type'], data: SessionEvent['data'], sessionId?: string): void {
    this.emit({
      id: randomUUID(),
      timestamp: Date.now(),
      category: 'session',
      type,
      scopeId: this.scopeId,
      sessionId: sessionId ?? data.sessionId,
      data,
    } as SessionEvent);
  }

  /**
   * Emit a request start event.
   */
  emitRequestStart(
    flowName: RequestFlowType | string,
    requestId: string,
    sessionId?: string,
    data?: Partial<RequestEvent['data']>,
  ): void {
    this.emit({
      id: randomUUID(),
      timestamp: Date.now(),
      category: 'request',
      type: 'request:start',
      scopeId: this.scopeId,
      sessionId,
      requestId,
      data: {
        flowName,
        ...data,
        requestBody: this.options.captureRequestBodies ? data?.requestBody : undefined,
        headers: data?.headers ? this.sanitizeHeaders(data.headers) : undefined,
      },
    } as RequestEvent);
  }

  /**
   * Emit a request complete event.
   */
  emitRequestComplete(
    flowName: RequestFlowType | string,
    requestId: string,
    durationMs: number,
    sessionId?: string,
    data?: Partial<RequestEvent['data']>,
  ): void {
    this.emit({
      id: randomUUID(),
      timestamp: Date.now(),
      category: 'request',
      type: 'request:complete',
      scopeId: this.scopeId,
      sessionId,
      requestId,
      data: {
        flowName,
        durationMs,
        ...data,
        responseBody: this.options.captureResponseBodies ? data?.responseBody : undefined,
      },
    } as RequestEvent);
  }

  /**
   * Emit a request error event.
   */
  emitRequestError(
    flowName: RequestFlowType | string,
    requestId: string,
    error: { name: string; message: string; code?: number },
    durationMs?: number,
    sessionId?: string,
    data?: Partial<RequestEvent['data']>,
  ): void {
    this.emit({
      id: randomUUID(),
      timestamp: Date.now(),
      category: 'request',
      type: 'request:error',
      scopeId: this.scopeId,
      sessionId,
      requestId,
      data: {
        flowName,
        durationMs,
        isError: true,
        error,
        ...data,
      },
    } as RequestEvent);
  }

  /**
   * Emit a server event.
   */
  emitServerEvent(type: ServerEvent['type'], data: ServerEvent['data']): void {
    this.emit({
      id: randomUUID(),
      timestamp: Date.now(),
      category: 'server',
      type,
      scopeId: this.scopeId,
      data,
    } as ServerEvent);
  }

  /**
   * Emit a scope graph update event.
   */
  emitScopeGraph(root: ScopeGraphNode): void {
    this.emit({
      id: randomUUID(),
      timestamp: Date.now(),
      category: 'server',
      type: 'scope:graph:update',
      scopeId: this.scopeId,
      data: { root },
    } as ScopeGraphEvent);
  }

  /**
   * Emit a config event.
   */
  emitConfigEvent(
    type: 'config:loaded' | 'config:error' | 'config:missing',
    data: {
      configPath?: string;
      errors?: Array<{ path: string; message: string }>;
      missingKeys?: string[];
      loadedKeys?: string[];
    },
  ): void {
    this.emit({
      id: randomUUID(),
      timestamp: Date.now(),
      category: 'config',
      type,
      scopeId: this.scopeId,
      data,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────

  private emit(event: DevEvent): void {
    if (!this.isActive) {
      return;
    }

    // Check exclusion list (with defensive null check)
    if (this.options?.excludeTypes?.includes(event.type)) {
      return;
    }

    // Apply sampling (with defensive null check)
    const samplingRate = this.options?.samplingRate ?? 1;
    if (samplingRate < 1 && Math.random() > samplingRate) {
      return;
    }

    // Buffer the event
    this.buffer.push(event);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // Don't let listener errors break the event bus
        console.error('[DevEventBus] Listener error:', err);
      }
    }

    // Send via transport
    this.sendToTransport(event);
  }

  private emitRegistryEvent(
    registryType: 'tool' | 'resource' | 'prompt' | 'agent',
    changeKind: 'added' | 'removed' | 'updated' | 'reset',
    changeScope: 'global' | 'session',
    snapshotCount: number,
    version: number,
  ): void {
    this.emit({
      id: randomUUID(),
      timestamp: Date.now(),
      category: 'registry',
      type: `registry:${registryType}:${changeKind}`,
      scopeId: this.scopeId,
      data: {
        registryType,
        changeKind,
        changeScope,
        snapshotCount,
        version,
      },
    } as RegistryEvent);
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    if (!this.options.sanitizeHeaders) {
      return headers;
    }

    const sanitized: Record<string, string> = {};
    const redactSet = new Set(this.options.redactHeaders.map((h) => h.toLowerCase()));

    for (const [key, value] of Object.entries(headers)) {
      if (redactSet.has(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private sendToTransport(event: DevEvent): void {
    const transport = this.options.transport;

    if (transport === 'ipc' || transport === 'auto') {
      // Try IPC first
      if (typeof process.send === 'function') {
        try {
          process.send({ type: '__FRONTMCP_DEV_EVENT__', event });
          return;
        } catch {
          // IPC failed, fall through to stderr if auto
          if (transport === 'ipc') {
            return; // Don't fall back if explicitly IPC
          }
        }
      }
    }

    if (transport === 'stderr' || transport === 'auto') {
      // Write to stderr with magic prefix
      try {
        const message = JSON.stringify(event);
        process.stderr.write(`__FRONTMCP_DEV_EVENT__${message}\n`);
      } catch {
        // Ignore transport errors
      }
    }
  }
}

// Re-export helper
export { isDevBusEnabled };
