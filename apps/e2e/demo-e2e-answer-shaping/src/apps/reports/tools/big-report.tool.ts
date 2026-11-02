import { Tool, ToolContext, z } from '@frontmcp/sdk';

/** About 300 KB of rows by default: well over the server's 64 KB answer budget. */
@Tool({
  name: 'big-report',
  description: 'A report with many rows',
  inputSchema: { rows: z.number().int().min(1).max(5000).default(1000) },
  outputSchema: {
    rows: z.array(z.object({ id: z.number(), title: z.string(), body: z.string() })),
    total: z.number(),
  },
})
export default class BigReportTool extends ToolContext {
  async execute({ rows }: { rows: number }) {
    return {
      rows: Array.from({ length: rows }, (_, index) => ({
        id: index,
        title: `Row ${index}`,
        body: `Body of row ${index} `.padEnd(280, '.'),
      })),
      total: rows,
    };
  }
}
