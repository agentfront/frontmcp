/**
 * Agent change event types and emitter.
 */

import type { AgentInstance } from './agent.instance';

// ============================================================================
// Event Types
// ============================================================================

/**
 * Types of changes that can occur in the agent registry.
 */
export type AgentChangeKind =
  | 'added'
  | 'removed'
  | 'updated'
  | 'reset'
  | 'execution_start'
  | 'execution_complete'
  | 'execution_error';

/**
 * Scope of the change event.
 */
export type AgentChangeScope = 'global' | 'scope' | 'app' | 'plugin' | 'agent';

/**
 * Event emitted when agents change.
 */
export interface AgentChangeEvent {
  /**
   * Type of change.
   */
  kind: AgentChangeKind;

  /**
   * Scope where the change occurred.
   */
  changeScope: AgentChangeScope;

  /**
   * Registry version number.
   */
  version: number;

  /**
   * Snapshot of all agents after the change.
   */
  snapshot: readonly AgentInstance[];

  /**
   * ID of the affected agent (for single-agent events).
   */
  agentId?: string;

  /**
   * Full name of the agent (including parent path).
   */
  agentFullName?: string;

  /**
   * Owner reference (app, plugin, or parent agent).
   */
  owner?: { kind: AgentChangeScope; id: string };

  /**
   * Timestamp of the event.
   */
  timestamp?: number;

  /**
   * Additional metadata for execution events.
   */
  execution?: {
    /** Run ID for this execution */
    runId: string;
    /** Input provided to the agent */
    input?: unknown;
    /** Output from the agent (for completion events) */
    output?: unknown;
    /** Error if execution failed */
    error?: Error;
    /** Duration in milliseconds */
    durationMs?: number;
  };
}

// ============================================================================
// Event Emitter
// ============================================================================

/**
 * Listener function type.
 */
export type AgentChangeListener = (event: AgentChangeEvent) => void;

/**
 * Unsubscribe function type.
 */
export type Unsubscribe = () => void;

/**
 * Event emitter for agent changes.
 *
 * Allows components to subscribe to agent lifecycle events.
 */
export class AgentEmitter {
  private listeners = new Set<AgentChangeListener>();

  /**
   * Subscribe to agent change events (alias for subscribe).
   *
   * @param listener Function to call when events occur
   * @returns Unsubscribe function
   */
  on(listener: AgentChangeListener): Unsubscribe {
    return this.subscribe(listener);
  }

  /**
   * Subscribe to agent change events.
   *
   * @param listener Function to call when events occur
   * @returns Unsubscribe function
   */
  subscribe(listener: AgentChangeListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners.
   */
  emit(event: AgentChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // Don't let listener errors propagate
        console.error('Error in agent change listener:', error);
      }
    }
  }

  /**
   * Remove all listeners.
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Get the number of listeners.
   */
  get size(): number {
    return this.listeners.size;
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /**
   * Emit an agent added event.
   */
  emitAdded(
    agentId: string,
    agentFullName: string,
    owner: { kind: AgentChangeScope; id: string },
    version: number,
    snapshot: readonly AgentInstance[],
  ): void {
    this.emit({
      kind: 'added',
      changeScope: owner.kind,
      version,
      snapshot,
      agentId,
      agentFullName,
      owner,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit an agent removed event.
   */
  emitRemoved(
    agentId: string,
    agentFullName: string,
    owner: { kind: AgentChangeScope; id: string },
    version: number,
    snapshot: readonly AgentInstance[],
  ): void {
    this.emit({
      kind: 'removed',
      changeScope: owner.kind,
      version,
      snapshot,
      agentId,
      agentFullName,
      owner,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit an execution start event.
   */
  emitExecutionStart(
    agentId: string,
    agentFullName: string,
    owner: { kind: AgentChangeScope; id: string },
    runId: string,
    version: number,
    snapshot: readonly AgentInstance[],
    input?: unknown,
  ): void {
    this.emit({
      kind: 'execution_start',
      changeScope: owner.kind,
      version,
      snapshot,
      agentId,
      agentFullName,
      owner,
      timestamp: Date.now(),
      execution: { runId, input },
    });
  }

  /**
   * Emit an execution complete event.
   */
  emitExecutionComplete(
    agentId: string,
    agentFullName: string,
    owner: { kind: AgentChangeScope; id: string },
    runId: string,
    output: unknown,
    durationMs: number,
    version: number,
    snapshot: readonly AgentInstance[],
  ): void {
    this.emit({
      kind: 'execution_complete',
      changeScope: owner.kind,
      version,
      snapshot,
      agentId,
      agentFullName,
      owner,
      timestamp: Date.now(),
      execution: { runId, output, durationMs },
    });
  }

  /**
   * Emit an execution error event.
   */
  emitExecutionError(
    agentId: string,
    agentFullName: string,
    owner: { kind: AgentChangeScope; id: string },
    runId: string,
    error: Error,
    durationMs: number,
    version: number,
    snapshot: readonly AgentInstance[],
  ): void {
    this.emit({
      kind: 'execution_error',
      changeScope: owner.kind,
      version,
      snapshot,
      agentId,
      agentFullName,
      owner,
      timestamp: Date.now(),
      execution: { runId, error, durationMs },
    });
  }
}

/**
 * Global agent emitter instance.
 */
export const agentEmitter = new AgentEmitter();
