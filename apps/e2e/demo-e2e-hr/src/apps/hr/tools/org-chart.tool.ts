import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

import { DEPARTMENTS, EMPLOYEES } from '../data/employees';

const inputSchema = {
  department: z.enum(DEPARTMENTS).optional().describe('Filter org chart to a specific department'),
};

const outputSchema = z
  .object({
    mermaid: z.string(),
    nodeCount: z.number(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'org_chart',
  description: 'Generate a Mermaid-based org chart showing the reporting structure.',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    widgetDescription: 'Displays an organizational chart as a Mermaid flowchart.',
    template: (ctx) => (ctx.output as Output).mermaid,
  },
})
export default class OrgChartTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    let filtered = EMPLOYEES;
    if (input.department) {
      filtered = filtered.filter((e) => e.department === input.department);
    }

    const employeeIds = new Set(filtered.map((e) => e.id));
    const lines: string[] = ['flowchart TD'];

    for (const emp of filtered) {
      const label = `${emp.name}\\n${emp.role}`;
      lines.push(`  ${emp.id}["${label}"]`);
    }

    for (const emp of filtered) {
      if (emp.manager && employeeIds.has(emp.manager)) {
        lines.push(`  ${emp.manager} --> ${emp.id}`);
      }
    }

    const mermaid = lines.join('\n');

    return {
      mermaid,
      nodeCount: filtered.length,
    };
  }
}
