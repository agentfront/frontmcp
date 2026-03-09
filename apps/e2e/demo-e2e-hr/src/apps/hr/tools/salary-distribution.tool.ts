import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { EMPLOYEES, SALARY_BANDS, DEPARTMENTS } from '../data/employees';

const inputSchema = {
  department: z.enum(DEPARTMENTS).optional().describe('Filter by department (all departments if omitted)'),
};

const outputSchema = z
  .object({
    chartJson: z.string(),
    totalEmployees: z.number(),
    bands: z.array(z.string()),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'salary_distribution',
  description: 'Show a pie chart of salary band distribution across employees.',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    widgetDescription: 'Displays a pie chart of salary band distribution.',
    template: (ctx) => {
      const chart = JSON.parse((ctx.output as Output).chartJson);
      const labels = chart.data.map((d: Record<string, unknown>) => d['name']);
      const colors = ['#4A90D9', '#50C878', '#FFB347', '#FF6B6B', '#9B59B6', '#E91E63', '#00BCD4'];
      const data = chart.data.map((d: Record<string, unknown>) => d['value']);
      return {
        type: chart.type,
        data: {
          labels,
          datasets: [{ data, backgroundColor: colors.slice(0, labels.length) }],
        },
        options: { responsive: true, plugins: { title: { display: !!chart.title, text: chart.title } } },
      };
    },
  },
})
export default class SalaryDistributionTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    let filtered = EMPLOYEES;
    if (input.department) filtered = filtered.filter((e) => e.department === input.department);

    const bandCounts = new Map<string, number>();
    for (const emp of filtered) {
      bandCounts.set(emp.salaryBand, (bandCounts.get(emp.salaryBand) ?? 0) + 1);
    }

    const data = Array.from(bandCounts.entries()).map(([bandId, count]) => ({
      name: SALARY_BANDS[bandId]?.label ?? bandId,
      value: count,
    }));

    const title = input.department
      ? `Salary Distribution - ${input.department}`
      : 'Salary Distribution - All Departments';

    const chart = {
      type: 'pie',
      data,
      title,
    };

    return {
      chartJson: JSON.stringify(chart),
      totalEmployees: filtered.length,
      bands: Array.from(bandCounts.keys()),
    };
  }
}
