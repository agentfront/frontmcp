import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    headers: z.array(z.string()).describe('Table column headers'),
    rows: z.array(z.array(z.string())).describe('Table row data'),
    title: z.string().optional().describe('Optional table title'),
  })
  .strict();

const outputSchema = z.object({
  uiType: z.literal('html'),
  html: z.string(),
  rowCount: z.number(),
  columnCount: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'html-table',
  description: 'Generate an HTML table from data',
  inputSchema,
  outputSchema,
  ui: {
    uiType: 'html',
    template: (ctx) => {
      const { headers, rows, title } = ctx.output as unknown as { headers: string[]; rows: string[][]; title?: string };
      const escapeHtml = ctx.helpers.escapeHtml;

      const headerCells = headers
        .map((h) => `<th style="border: 1px solid #ddd; padding: 8px; background: #f4f4f4;">${escapeHtml(h)}</th>`)
        .join('');
      const rowsHtml = rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td style="border: 1px solid #ddd; padding: 8px;">${escapeHtml(cell)}</td>`)
              .join('')}</tr>`,
        )
        .join('');

      return `
        <div style="font-family: sans-serif;">
          ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
          <table style="border-collapse: collapse; width: 100%;">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    },
  },
})
export default class HtmlTableTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      uiType: 'html',
      html: `<table>${input.headers.length} columns, ${input.rows.length} rows</table>`,
      rowCount: input.rows.length,
      columnCount: input.headers.length,
    };
  }
}
