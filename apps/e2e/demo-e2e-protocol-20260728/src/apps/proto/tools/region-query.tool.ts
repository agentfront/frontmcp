import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

/**
 * Exercises the `x-mcp-header` schema extension from protocol 2026-07-28.
 *
 * `region` is mirrored into the `Mcp-Param-Region` HTTP header by conforming
 * clients; the server MUST validate that the header matches the body value and
 * reject a mismatch with `-32020` (HeaderMismatch).
 */
const inputSchema = {
  region: z.string().describe('Region to run the query in').meta({ 'x-mcp-header': 'Region' }),
  query: z.string().describe('The query to run'),
};

const outputSchema = z.object({
  region: z.string(),
  query: z.string(),
});

type Input = z.output<z.ZodObject<typeof inputSchema>>;
type Output = z.output<typeof outputSchema>;

@Tool({
  name: 'region-query',
  description: 'Runs a query in a given region; region is mirrored into an HTTP header',
  inputSchema,
  outputSchema,
})
export default class RegionQueryTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { region: input.region, query: input.query };
  }
}
