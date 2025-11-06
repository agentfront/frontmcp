import {tool} from "@frontmcp/sdk";
import {z} from "zod";

export const AddTool = tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: {a: z.number(), b: z.number()},
  outputSchema: {result: z.number()}
})(async (input, ctx) => {
  return {
    result: input.a + input.b,
  };
})
