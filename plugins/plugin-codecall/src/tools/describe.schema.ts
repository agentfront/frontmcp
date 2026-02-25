// file: libs/plugins/src/codecall/tools/describe.schema.ts
import { z } from 'zod';
import { ToolAnnotationsSchema } from '@modelcontextprotocol/sdk/types.js';

export const describeToolDescription = `Get input/output schemas for tools from search results.

INPUT: toolNames: string[] - tool names from search
OUTPUT per tool: inputSchema (JSON Schema), outputSchema (JSON Schema), usageExamples (up to 5 callTool examples)

IMPORTANT: If notFound array is non-empty → re-search with corrected queries.
FLOW: search → describe → execute/invoke`;

export const describeToolInputSchema = {
  toolNames: z
    .array(z.string())
    .min(1)
    .superRefine((toolNames, ctx) => {
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const name of toolNames) {
        if (seen.has(name)) {
          duplicates.add(name);
        }
        seen.add(name);
      }
      if (duplicates.size > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate tool names are not allowed: ${Array.from(duplicates).join(', ')}`,
        });
      }
    })
    .describe(
      'Array of unique tool names (from codecall:search results) to fetch their detailed schemas and usage examples. Example: ["users:list", "billing:getInvoice"]',
    ),
};

export type DescribeToolInput = z.input<z.ZodObject<typeof describeToolInputSchema>>;

export const describeToolOutputSchema = z.object({
  tools: z
    .array(
      z.object({
        name: z.string().describe('Tool name to be used in callTool() within codecall:execute scripts'),
        appId: z.string().describe('The app ID this tool belongs to'),
        description: z.string().describe('Detailed description of what this tool does'),
        inputSchema: z
          .record(z.string(), z.unknown())
          .nullable()
          .describe('JSON Schema object describing the tool input parameters'),
        outputSchema: z
          .record(z.string(), z.unknown())
          .nullable()
          .describe('JSON Schema object describing the tool output structure'),
        annotations: ToolAnnotationsSchema.optional().describe('MCP tool annotations (metadata)'),
        usageExamples: z
          .array(
            z.object({
              description: z.string().describe('Description of what this example demonstrates'),
              code: z
                .string()
                .describe(
                  'JavaScript code example showing how to call this tool using callTool(). Format: const result = await callTool("tool:name", { ...params });',
                ),
            }),
          )
          .max(5)
          .describe('Up to 5 practical examples of how to use this tool in a codecall:execute script'),
      }),
    )
    .describe('Array of tool descriptions with schemas and usage examples'),
  notFound: z
    .array(z.string())
    .optional()
    .describe('Tool names that were requested but not found in the index. Check these for typos.'),
});

export type DescribeToolOutput = z.infer<typeof describeToolOutputSchema>;
