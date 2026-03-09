import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { QUARTERLY_HIRING } from '../data/employees';

const inputSchema = {
  showCumulative: z.boolean().optional().default(false).describe('Show cumulative hiring alongside quarterly hires'),
};

const outputSchema = z
  .object({
    chartJson: z.string(),
    totalHires: z.number(),
    quarters: z.number(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'team_growth',
  description: 'Show a line chart of quarterly hiring trends over time.',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    widgetDescription: 'Displays a line chart of quarterly hiring trends.',
    template: (ctx) => {
      const chart = JSON.parse((ctx.output as Output).chartJson);
      const labels = chart.data.map((d: Record<string, unknown>) => d[chart.xKey || 'quarter']);
      const lineColors = ['#4A90D9', '#50C878', '#FFB347', '#FF6B6B', '#9B59B6'];
      const datasets = (chart.yKeys || ['hires']).map((key: string, i: number) => ({
        label: key,
        data: chart.data.map((d: Record<string, unknown>) => d[key]),
        borderColor: lineColors[i % lineColors.length],
        fill: false,
        tension: 0.3,
      }));
      return {
        type: chart.type,
        data: { labels, datasets },
        options: { responsive: true, plugins: { title: { display: !!chart.title, text: chart.title } } },
      };
    },
  },
})
export default class TeamGrowthTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const totalHires = QUARTERLY_HIRING.reduce((sum, q) => sum + q.hires, 0);

    let cumulative = 0;
    const data = QUARTERLY_HIRING.map((q) => {
      cumulative += q.hires;
      const point: Record<string, string | number> = {
        quarter: q.quarter,
        hires: q.hires,
      };
      if (input.showCumulative) {
        point['cumulative'] = cumulative;
      }
      return point;
    });

    const yKeys = input.showCumulative ? ['hires', 'cumulative'] : ['hires'];

    const chart = {
      type: 'line',
      data,
      xKey: 'quarter',
      yKeys,
      title: 'Quarterly Hiring Trends',
    };

    return {
      chartJson: JSON.stringify(chart),
      totalHires,
      quarters: QUARTERLY_HIRING.length,
    };
  }
}
