// file: libs/sdk/src/channel/sources/completion-events.ts

import type { AgentCompletionEvent } from './agent-completion.source';
import type { JobCompletionEvent } from './job-completion.source';

type Listener<T> = (event: T) => void;

/** One kind of completion event: listeners are called in order, and one that throws doesn't stop the rest. */
class CompletionStream<T> {
  private readonly listeners = new Set<Listener<T>>();

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A channel source's failure is its own; the run that completed is not affected.
      }
    }
  }
}

/**
 * The agent and job completions of one scope, which the `agent-completion` and `job-completion`
 * channel sources subscribe to. The `agents:call-agent` flow publishes agent runs, and the job
 * execution manager's status notifications publish job and workflow runs.
 */
export class ScopeCompletionEvents {
  readonly agents = new CompletionStream<AgentCompletionEvent>();
  readonly jobs = new CompletionStream<JobCompletionEvent>();
}

const byScope = new WeakMap<object, ScopeCompletionEvents>();

/** The completion events of a scope, created on first use. */
export function completionEventsOf(scope: object): ScopeCompletionEvents {
  let events = byScope.get(scope);
  if (!events) {
    events = new ScopeCompletionEvents();
    byScope.set(scope, events);
  }
  return events;
}

/** A run's result as channel event text: strings as they are, anything else as JSON. */
export function completionOutputText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
