import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'max',
  description: 'Maximum value in an array of numbers',
  inputSchema: {values: z.array(z.number()).min(1)},
  outputSchema: {result: z.number()}
})
export default class MaxTool extends ToolContext {
  async execute(input: { values: number[] }) {
    return {
      result: Math.max(...input.values),
    };
  }
}
