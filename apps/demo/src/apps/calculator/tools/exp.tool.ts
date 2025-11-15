import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'exp',
  description: 'e raised to the power of x',
  inputSchema: {x: z.number()},
  outputSchema: {result: z.number()}
})
export default class ExpTool extends ToolContext {
  async execute(input: { x: number }) {
    return {
      result: Math.exp(input.x),
    };
  }
}
