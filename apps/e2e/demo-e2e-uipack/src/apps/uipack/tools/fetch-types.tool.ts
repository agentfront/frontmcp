import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { createTypeFetcher } from '@frontmcp/uipack';

const inputSchema = {
  imports: z.array(z.string()).max(50).describe('Array of import statements to fetch types for'),
  maxDepth: z
    .number()
    .min(1)
    .max(10)
    .optional()
    .default(2)
    .describe('Maximum depth for recursive dependency resolution'),
  timeout: z.number().min(1000).max(30000).optional().default(10000).describe('Timeout in milliseconds per request'),
};

const outputSchema = z.object({
  resultCount: z.number(),
  errorCount: z.number(),
  results: z.array(
    z.object({
      specifier: z.string(),
      resolvedPackage: z.string(),
      version: z.string(),
      contentLength: z.number(),
      fileCount: z.number(),
    }),
  ),
  errors: z.array(
    z.object({
      specifier: z.string(),
      code: z.string(),
      message: z.string(),
    }),
  ),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'fetch-types',
  description: 'Fetch TypeScript .d.ts type definitions for given import statements',
  inputSchema,
  outputSchema,
})
export default class FetchTypesTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const fetcher = createTypeFetcher({
      maxDepth: input.maxDepth,
      timeout: input.timeout,
    });

    const batchResult = await fetcher.fetchBatch({
      imports: input.imports,
    });

    return {
      resultCount: batchResult.results.length,
      errorCount: batchResult.errors.length,
      results: batchResult.results.map((r) => ({
        specifier: r.specifier,
        resolvedPackage: r.resolvedPackage,
        version: r.version,
        contentLength: r.content.length,
        fileCount: r.files.length,
      })),
      errors: batchResult.errors.map((e) => ({
        specifier: e.specifier,
        code: e.code,
        message: e.message,
      })),
    };
  }
}
