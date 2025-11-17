// file: libs/plugins/src/codecall/tools/describe.schema.ts
import { z } from 'zod';
import { ToolAnnotationsSchema } from '@modelcontextprotocol/sdk/types.js';

export const describeToolInputSchema = {
  toolNames: z
    .array(z.string())
    .describe("Array of unique tool names (from codecall:search tool) to fetch it's details")
    .min(1),
};

export type DescribeToolInput = z.baseObjectInputType<typeof describeToolInputSchema>;

export const describeToolOutputSchema = z.array(
  z.object({
    name: z.string().describe('Tool name to be used for execution'),
    description: z.string().describe('Tool description'),
    inputSchema: z.object({}).passthrough().describe("Tool's input schema object"),
    outputSchema: z.object({}).passthrough().describe("Tool's output schema object"),
    annotations: ToolAnnotationsSchema.describe("Tool's mcp annotation object"),
  }),
);
export type DescribeToolOutput = z.infer<typeof describeToolOutputSchema>;
