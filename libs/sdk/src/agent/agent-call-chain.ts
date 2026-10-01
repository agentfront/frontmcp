/**
 * The agents whose runs are in progress, outermost first, tracked per async call chain.
 *
 * An agent reaches another through its model's tool calls (a nested agent, a swarm agent), through
 * `this.invokeAgent()`, or through `this.callTool('invoke_<agent>')`. Every one of them runs the
 * called agent through the `agents:call-agent` flow inside the caller's run, so the chain of running
 * agents follows the async call chain, the way the running tool does (see `running-tool.ts`). The
 * flow refuses a call that would make the chain deeper than an agent in it allows
 * (`swarm.maxCallDepth`), which stops agents that call each other from looping forever.
 */
import { AsyncLocalStorage } from '@frontmcp/utils';

/** An agent whose run is in progress. */
export interface RunningAgent {
  /** The agent's id. */
  readonly id: string;
  /** How many agent-to-agent calls deep a chain this agent runs in may go (`swarm.maxCallDepth`). */
  readonly maxCallDepth: number;
}

/** The `swarm.maxCallDepth` of an agent that doesn't set one. */
export const DEFAULT_MAX_AGENT_CALL_DEPTH = 3;

const chains = new AsyncLocalStorage<readonly RunningAgent[]>();

/**
 * Run `fn` as `agent`, a step deeper in the current chain of running agents.
 * @internal Used by the `agents:call-agent` flow around the agent's `execute()`.
 */
export function runAsAgent<T>(agent: RunningAgent, fn: () => T): T {
  return chains.run([...getAgentCallChain(), agent], fn);
}

/** The agents whose runs the calling code is part of, outermost first; empty outside any agent. */
export function getAgentCallChain(): readonly RunningAgent[] {
  return chains.getStore() ?? [];
}

/**
 * How deep a call to another agent made now would be, and the deepest the running agents allow:
 * the call made by the only running agent is call 1. `undefined` outside any agent.
 */
export function nextAgentCallDepth(): { depth: number; limit: number; chain: readonly RunningAgent[] } | undefined {
  const chain = getAgentCallChain();
  if (chain.length === 0) return undefined;
  const limit = Math.min(...chain.map((agent) => agent.maxCallDepth));
  return { depth: chain.length, limit, chain };
}
