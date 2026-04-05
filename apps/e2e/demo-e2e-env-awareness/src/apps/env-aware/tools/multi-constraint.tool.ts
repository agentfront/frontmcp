import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool with multiple constraints (AND semantics).
 * All fields must match: current platform + Node runtime + standalone.
 * Should be visible in e2e tests.
 */
@Tool({
  name: 'multi_constraint_tool',
  description: 'Tool with platform + runtime + deployment constraints',
  inputSchema,
  availableWhen: {
    platform: [process.platform],
    runtime: ['node'],
    deployment: ['standalone'],
  },
})
export default class MultiConstraintTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `multi(${process.platform}/node/standalone): ${input.msg}`;
  }
}
