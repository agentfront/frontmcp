// file: libs/sdk/src/common/entries/agent.entry.ts

import { BaseEntry, EntryOwnerRef } from './base.entry';
import { AgentRecord } from '../records';
import { AgentContext } from '../interfaces';
import { AgentMetadata, ToolInputType, ToolOutputType } from '../metadata';
import { Request, Notification, CallToolRequest, CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { AgentInputOf, AgentOutputOf } from '../decorators';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Arguments for invoking an agent (same as tool call args).
 */
export type AgentCallArgs = CallToolRequest['params']['arguments'];

/**
 * Extra context passed during agent invocation.
 */
export type AgentCallExtra = RequestHandlerExtra<Request, Notification> & {
  authInfo: AuthInfo;
};

/**
 * Parsed result of an agent execution.
 */
export type ParsedAgentResult = CallToolResult;

// Import SafeTransformResult from tool.entry to avoid duplication
import { SafeTransformResult } from './tool.entry';

// ============================================================================
// Agent Entry Abstract Class
// ============================================================================

/**
 * Abstract base class for agent entries.
 *
 * AgentEntry represents a registered agent in the registry and provides
 * the interface for creating AgentContext instances, parsing input/output,
 * and exposing the agent as a callable tool.
 *
 * Concrete implementation: AgentInstance (in libs/sdk/src/agent/agent.instance.ts)
 */
export abstract class AgentEntry<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = AgentInputOf<{ inputSchema: InSchema }>,
  Out = AgentOutputOf<{ outputSchema: OutSchema }>,
> extends BaseEntry<AgentRecord, AgentContext<InSchema, OutSchema, In, Out>, AgentMetadata> {
  /**
   * Owner reference (app, plugin, or parent agent).
   */
  owner: EntryOwnerRef;

  /**
   * The name of the agent, as declared in the metadata.
   */
  name: string;

  /**
   * The full name of the agent, including the owner name as prefix.
   */
  fullName: string;

  /**
   * The unique ID of the agent.
   */
  id: string;

  /**
   * Input schema for the agent (Zod shape or object).
   */
  inputSchema?: InSchema;

  /**
   * Raw JSON schema for the input (used in tool definition).
   */
  rawInputSchema?: any;

  /**
   * Output schema for the agent.
   */
  outputSchema?: OutSchema;

  /**
   * System instructions for the agent's LLM.
   */
  systemInstructions?: string;

  // ============================================================================
  // Schema Accessors
  // ============================================================================

  /**
   * Get the agent's input schema.
   */
  getInputSchema(): InSchema | undefined {
    return this.inputSchema;
  }

  /**
   * Get the agent's output schema.
   */
  getOutputSchema(): OutSchema | undefined {
    return this.outputSchema;
  }

  // ============================================================================
  // Abstract Methods
  // ============================================================================

  /**
   * Create an agent context for execution.
   *
   * @param input - The parsed input arguments
   * @param ctx - Extra context (authInfo, etc.)
   * @returns AgentContext instance ready for execution
   */
  abstract create(input: AgentCallArgs, ctx: AgentCallExtra): AgentContext<InSchema, OutSchema, In, Out>;

  /**
   * Parse and validate the raw input into agent input format.
   *
   * @param input - Raw input from the call request
   * @returns Validated input arguments
   */
  abstract parseInput(input: CallToolRequest['params']): AgentCallArgs;

  /**
   * Parse the agent's output into MCP CallToolResult format.
   *
   * @param result - Raw output from agent execution
   * @returns Parsed result in MCP format
   * @throws Error if parsing fails
   */
  abstract parseOutput(result: Out | Partial<Out> | any): ParsedAgentResult;

  /**
   * Safely parse the agent's output (returns success/error instead of throwing).
   *
   * @param raw - Raw output from agent execution
   * @returns Success with parsed data, or failure with error
   */
  abstract safeParseOutput(raw: Out | Partial<Out> | any): SafeTransformResult<ParsedAgentResult>;

  /**
   * Get the tool definition for this agent.
   *
   * Agents are automatically exposed as callable tools with the name
   * `invoke_<agent_id>`. This method returns the MCP Tool definition
   * that describes the agent as a tool.
   *
   * @returns MCP Tool definition
   */
  abstract getToolDefinition(): Tool;

  /**
   * Check if this agent is visible to other agents in the swarm.
   *
   * @returns true if visible, false if hidden
   */
  abstract isVisibleToSwarm(): boolean;

  /**
   * Check if this agent can see other agents in the swarm.
   *
   * @returns true if can see others, false if isolated
   */
  abstract canSeeSwarm(): boolean;

  /**
   * Get the list of agent IDs this agent can see.
   *
   * @returns Array of visible agent IDs (empty if canSeeSwarm is false)
   */
  abstract getVisibleAgentIds(): string[];
}
