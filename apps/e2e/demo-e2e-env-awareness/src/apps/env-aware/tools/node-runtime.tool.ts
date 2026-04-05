import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool constrained to the Node.js runtime.
 * Since e2e tests run in Node, this should always be visible.
 */
@Tool({
  name: 'node_runtime_tool',
  description: 'Tool only available in Node.js runtime',
  inputSchema,
  availableWhen: { runtime: ['node'] },
})
export default class NodeRuntimeTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `node: ${input.msg}`;
  }
}
