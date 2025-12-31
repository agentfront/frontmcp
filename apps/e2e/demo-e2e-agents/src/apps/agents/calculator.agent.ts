import { Agent, AgentContext, AgentLlmAdapter } from '@frontmcp/sdk';
import { z } from 'zod';

/**
 * Mock LLM adapter for calculator that evaluates simple math.
 */
const mockCalculatorAdapter: AgentLlmAdapter = {
  async completion(prompt) {
    const userMessage = prompt.messages.find((m) => m.role === 'user');
    const expression = userMessage?.content ?? '0';

    try {
      // Simple safe math evaluation (only numbers and basic operators)
      const sanitized = expression.replace(/[^0-9+\-*/().]/g, '');
      // eslint-disable-next-line no-eval
      const result = Function('"use strict"; return (' + sanitized + ')')();

      return {
        content: `The result is: ${result}`,
        finishReason: 'stop',
        usage: { promptTokens: 15, completionTokens: 10 },
      };
    } catch {
      return {
        content: 'Unable to calculate the expression',
        finishReason: 'stop',
        usage: { promptTokens: 15, completionTokens: 5 },
      };
    }
  },
};

/**
 * Calculator Agent for testing agent with tools capability.
 *
 * Demonstrates:
 * - Agent with specific input/output schemas
 * - Tool-like behavior in an agent context
 * - Error handling in agents
 */
@Agent({
  id: 'calculator-agent',
  name: 'calculator-agent',
  description: 'An agent that can perform mathematical calculations',
  systemInstructions: 'You are a calculator assistant. Evaluate mathematical expressions.',
  inputSchema: {
    expression: z.string().describe('The mathematical expression to evaluate'),
  },
  outputSchema: z.object({
    result: z.number().describe('The calculated result'),
    expression: z.string().describe('The original expression'),
    success: z.boolean().describe('Whether the calculation succeeded'),
    error: z.string().optional().describe('Error message if calculation failed'),
  }),
  llm: { adapter: mockCalculatorAdapter },
  swarm: {
    isVisible: true, // Visible to other agents
  },
})
export class CalculatorAgent extends AgentContext {
  async execute(input: { expression: string }): Promise<{
    result: number;
    expression: string;
    success: boolean;
    error?: string;
  }> {
    this.logger.info(`Calculator agent evaluating: ${input.expression}`);

    try {
      // Safe evaluation using only numbers and basic operators
      const sanitized = input.expression.replace(/[^0-9+\-*/().]/g, '');

      if (!sanitized || sanitized.length === 0) {
        return {
          result: 0,
          expression: input.expression,
          success: false,
          error: 'Invalid expression: contains no valid mathematical characters',
        };
      }

      // eslint-disable-next-line no-eval
      const result = Function('"use strict"; return (' + sanitized + ')')();

      if (typeof result !== 'number' || isNaN(result)) {
        return {
          result: 0,
          expression: input.expression,
          success: false,
          error: 'Result is not a valid number',
        };
      }

      return {
        result,
        expression: input.expression,
        success: true,
      };
    } catch (error) {
      return {
        result: 0,
        expression: input.expression,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
