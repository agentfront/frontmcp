// file: libs/plugins/src/codecall/tools/describe.schema.ts
import { z } from '@frontmcp/lazy-zod';
import { ToolAnnotationsSchema } from '@frontmcp/protocol';

export const describeToolDescription = `Get input/output schemas for tools from search results.

INPUT: toolNames: string[] - tool names from search, at most the server's maxDefinitions (8 unless configured) per call
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

export type DescribeToolInput = z.infer<z.ZodObject<typeof describeToolInputSchema>>;

export const describeToolOutputSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      appId: z.string(),
      description: z.string(),
      inputSchema: z.record(z.string(), z.unknown()).nullable(),
      outputSchema: z.record(z.string(), z.unknown()).nullable(),
      annotations: ToolAnnotationsSchema.optional(),
      usageExamples: z
        .array(
          z.object({
            description: z.string(),
            code: z.string(),
          }),
        )
        .max(5),
    }),
  ),
  notFound: z.array(z.string()).optional(),
});

export type DescribeToolOutput = z.infer<typeof describeToolOutputSchema>;
