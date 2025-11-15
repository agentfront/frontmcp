import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'pow',
  description: 'Raise a to the power of b (a^b)',
  inputSchema: {a: z.number(), b: z.number()},
  outputSchema: {result: z.number()}
})
export default class PowTool extends ToolContext {
  async execute(input: { a: number, b: number }) {
    const result = Math.pow(input.a, input.b);
    return {
      result,
    };
  }
}
