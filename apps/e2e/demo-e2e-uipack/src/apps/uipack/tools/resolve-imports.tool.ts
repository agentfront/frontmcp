import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { rewriteImports, createEsmShResolver } from '@frontmcp/uipack';

const inputSchema = {
  source: z.string().describe('Source code containing import statements'),
  skipPackages: z.array(z.string()).optional().describe('Packages to skip during rewriting'),
};

const outputSchema = z.object({
  code: z.string(),
  rewrittenCount: z.number(),
  rewrites: z.record(z.string(), z.string()),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'resolve-imports',
  description: 'Rewrite bare import specifiers to CDN URLs using esm.sh resolver',
  inputSchema,
  outputSchema,
})
export default class ResolveImportsTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const resolver = createEsmShResolver();
    const result = rewriteImports(input.source, {
      resolver,
      skipPackages: input.skipPackages,
    });

    const rewrites: Record<string, string> = {};
    for (const [key, value] of result.rewrites) {
      rewrites[key] = value;
    }

    return {
      code: result.code,
      rewrittenCount: result.rewrittenCount,
      rewrites,
    };
  }
}
