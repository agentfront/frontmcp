import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'min',
  description: 'Minimum value in an array of numbers',
  inputSchema: {values: z.array(z.number()).min(1)},
  outputSchema: {result: z.number()}
})
export default class MinTool extends ToolContext {
  async execute(input: { values: number[] }) {
    return {
      result: Math.min(...input.values),
    };
  }
}
