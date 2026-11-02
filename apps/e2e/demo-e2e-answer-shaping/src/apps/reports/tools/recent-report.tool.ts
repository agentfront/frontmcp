import { Tool, ToolContext, z } from '@frontmcp/sdk';

/** About 300 KB of rows whose schema needs at least 500 of them: the budget cannot cut it. */
@Tool({
  name: 'recent-report',
  description: 'A report that always lists at least 500 rows',
  inputSchema: {},
  outputSchema: {
    rows: z.array(z.object({ id: z.number(), body: z.string() })).min(500),
  },
})
export default class RecentReportTool extends ToolContext {
  async execute() {
    return {
      rows: Array.from({ length: 1000 }, (_, index) => ({ id: index, body: `Row ${index} `.padEnd(280, '.') })),
    };
  }
}
