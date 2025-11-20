import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'floor',
  description: 'Floor of x (largest integer ≤ x)',
  inputSchema: {x: z.number()},
  outputSchema: 'number'
})
export default class FloorTool extends ToolContext {
  async execute(input: { x: number }) {
    return Math.floor(input.x)
  }
}
