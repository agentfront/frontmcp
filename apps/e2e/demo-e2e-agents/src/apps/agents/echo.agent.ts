import { Agent, AgentContext, AgentLlmAdapter } from '@frontmcp/sdk';
import { z } from 'zod';

/**
 * Mock LLM adapter that simply echoes the input.
 * Used for E2E testing without requiring real API keys.
 */
const mockEchoAdapter: AgentLlmAdapter = {
  async completion(prompt) {
    // Extract the user's message and echo it
    const userMessage = prompt.messages.find((m) => m.role === 'user');
    const content = userMessage?.content ?? 'No message provided';

    return {
      content: `Echo: ${content}`,
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5 },
    };
  },
};

/**
 * Simple Echo Agent for testing basic agent functionality.
 *
 * This agent echoes back the input message, demonstrating:
 * - Basic agent registration
 * - Input/output schema validation
 * - Agent invocation as a tool
 */
@Agent({
  id: 'echo-agent',
  name: 'echo-agent',
  description: 'A simple agent that echoes back the input message',
  systemInstructions: 'You are an echo bot. Simply repeat what the user says.',
  inputSchema: {
    message: z.string().describe('The message to echo'),
  },
  outputSchema: z.object({
    echoed: z.string().describe('The echoed message'),
    timestamp: z.string().describe('When the message was echoed'),
  }),
  llm: { adapter: mockEchoAdapter },
})
export class EchoAgent extends AgentContext {
  async execute(input: { message: string }): Promise<{ echoed: string; timestamp: string }> {
    this.logger.info(`Echo agent received: ${input.message}`);

    return {
      echoed: `Echo: ${input.message}`,
      timestamp: new Date().toISOString(),
    };
  }
}
