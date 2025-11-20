// file: libs/plugins/src/codecall/tools/describe.schema.ts
import { z } from 'zod';
import { ToolAnnotationsSchema } from '@modelcontextprotocol/sdk/types.js';

export const describeToolInputSchema = z.object({
  toolNames: z
    .array(z.string())
    .min(1)
    .describe(
      'Array of unique tool names (from codecall:search results) to fetch their detailed schemas and usage examples. Example: ["users:list", "billing:getInvoice"]',
    ),
});

export type DescribeToolInput = z.infer<typeof describeToolInputSchema>;

export const describeToolOutputSchema = z.object({
  tools: z
    .array(
      z.object({
        name: z.string().describe('Tool name to be used in callTool() within code-call:execute scripts'),
        appId: z.string().describe('The app ID this tool belongs to'),
        description: z.string().describe('Detailed description of what this tool does'),
        inputSchema: z.any().describe('JSON Schema object describing the tool input parameters'),
        outputSchema: z.any().describe('JSON Schema object describing the tool output structure'),
        annotations: ToolAnnotationsSchema.optional().describe('MCP tool annotations (metadata)'),
        usageExample: z
          .object({
            description: z.string().describe('Description of what this example demonstrates'),
            code: z
              .string()
              .describe(
                'JavaScript code example showing how to call this tool using callTool(). Format: const result = await callTool("tool:name", { ...params });',
              ),
          })
          .describe('A practical example of how to use this tool in a code-call:execute script'),
      }),
    )
    .describe('Array of tool descriptions with schemas and usage examples'),
  notFound: z
    .array(z.string())
    .optional()
    .describe('Tool names that were requested but not found in the index. Check these for typos.'),
});

export type DescribeToolOutput = z.infer<typeof describeToolOutputSchema>;
