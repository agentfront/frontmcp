import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'modulo',
  description: 'Remainder of a divided by b (JavaScript % semantics)',
  inputSchema: {a: z.number(), b: z.number().refine((n) => n !== 0, 'Modulo by zero is not allowed')},
  outputSchema: 'number'
})
export default class ModuloTool extends ToolContext {
  async execute(input: { a: number, b: number }) {
    return input.a % input.b;
  }
}
