import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'min',
  description: 'Minimum value in an array of numbers',
  inputSchema: {values: z.array(z.number()).min(1)},
  outputSchema: 'number'
})
export default class MinTool extends ToolContext {
  async execute(input: { values: number[] }) {
    return Math.min(...input.values);
  }
}
