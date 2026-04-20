import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { EMPLOYEES } from '../data/employees';

const inputSchema = {
  includeOnLeave: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether to include employees on leave in the headcount'),
};

const outputSchema = z
  .object({
    chartJson: z.string(),
    totalHeadcount: z.number(),
    departmentCount: z.number(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'headcount_by_department',
  description: 'Show a bar chart of headcount broken down by department.',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    widgetDescription: 'Displays a bar chart showing headcount per department.',
    template: (ctx) => {
      const chart = JSON.parse((ctx.output as Output).chartJson);
      const labels = chart.data.map((d: Record<string, unknown>) => d[chart.xKey || 'name']);
      const datasets = (chart.yKeys || ['value']).map((key: string, i: number) => ({
        label: key,
        data: chart.data.map((d: Record<string, unknown>) => d[key]),
        backgroundColor: ['#4A90D9', '#50C878', '#FFB347', '#FF6B6B', '#9B59B6'][i % 5],
      }));
      return {
        type: chart.type,
        data: { labels, datasets },
        options: { responsive: true, plugins: { title: { display: !!chart.title, text: chart.title } } },
      };
    },
  },
})
export default class HeadcountByDepartmentTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const filtered = input.includeOnLeave
      ? EMPLOYEES.filter((e) => e.status !== 'offboarding')
      : EMPLOYEES.filter((e) => e.status === 'active');

    const counts = new Map<string, number>();
    for (const emp of filtered) {
      counts.set(emp.department, (counts.get(emp.department) ?? 0) + 1);
    }

    const data = Array.from(counts.entries()).map(([name, headcount]) => ({
      name,
      headcount,
    }));

    const chart = {
      type: 'bar',
      data,
      xKey: 'name',
      yKeys: ['headcount'],
      title: 'Headcount by Department',
    };

    return {
      chartJson: JSON.stringify(chart),
      totalHeadcount: filtered.length,
      departmentCount: counts.size,
    };
  }
}
