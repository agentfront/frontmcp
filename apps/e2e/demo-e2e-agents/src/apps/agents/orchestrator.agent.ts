import { Agent, AgentContext, AgentLlmAdapter } from '@frontmcp/sdk';
import { z } from 'zod';

/**
 * Mock LLM adapter for orchestrator that simulates agent coordination.
 */
const mockOrchestratorAdapter: AgentLlmAdapter = {
  async completion(prompt) {
    const userMessage = prompt.messages.find((m) => m.role === 'user');
    const task = userMessage?.content ?? 'Unknown task';

    return {
      content: `Orchestrating task: ${task}. Coordinating with available agents.`,
      finishReason: 'stop',
      usage: { promptTokens: 20, completionTokens: 15 },
    };
  },
};

/**
 * Orchestrator Agent for testing agent swarm functionality.
 *
 * Demonstrates:
 * - Agent that can see other agents (canSeeOtherAgents: true)
 * - Whitelist-based agent visibility
 * - Multi-agent coordination pattern
 */
@Agent({
  id: 'orchestrator-agent',
  name: 'orchestrator-agent',
  description: 'An orchestrator agent that coordinates other agents',
  systemInstructions: `You are an orchestrator agent. You can coordinate with other agents to complete tasks.
Available agents:
- calculator-agent: For mathematical calculations
- echo-agent: For echoing messages

Delegate tasks to the appropriate agent based on the request.`,
  inputSchema: {
    task: z.string().describe('The task to orchestrate'),
    targetAgents: z.array(z.string()).optional().describe('Specific agents to use'),
  },
  outputSchema: z.object({
    taskReceived: z.string().describe('The original task'),
    agentsAvailable: z.array(z.string()).describe('Agents available for orchestration'),
    status: z.enum(['completed', 'delegated', 'failed']).describe('Task status'),
    result: z.string().optional().describe('Result from coordinated execution'),
  }),
  llm: { adapter: mockOrchestratorAdapter },
  swarm: {
    canSeeOtherAgents: true,
    visibleAgents: ['calculator-agent', 'echo-agent'], // Can see these agents
    isVisible: true, // Other agents can see this one too
  },
})
export class OrchestratorAgent extends AgentContext {
  async execute(input: { task: string; targetAgents?: string[] }): Promise<{
    taskReceived: string;
    agentsAvailable: string[];
    status: 'completed' | 'delegated' | 'failed';
    result?: string;
  }> {
    this.logger.info(`Orchestrator agent received task: ${input.task}`);

    // Simulate orchestration logic
    const availableAgents = input.targetAgents ?? ['calculator-agent', 'echo-agent'];

    // Simple task classification
    const taskLower = input.task.toLowerCase();

    if (
      taskLower.includes('calculate') ||
      taskLower.includes('math') ||
      taskLower.includes('+') ||
      taskLower.includes('*')
    ) {
      return {
        taskReceived: input.task,
        agentsAvailable: availableAgents,
        status: 'delegated',
        result: `Task delegated to calculator-agent for mathematical evaluation`,
      };
    }

    if (taskLower.includes('echo') || taskLower.includes('repeat')) {
      return {
        taskReceived: input.task,
        agentsAvailable: availableAgents,
        status: 'delegated',
        result: `Task delegated to echo-agent for message echoing`,
      };
    }

    // Generic completion
    return {
      taskReceived: input.task,
      agentsAvailable: availableAgents,
      status: 'completed',
      result: `Orchestrator processed task directly: ${input.task}`,
    };
  }
}
