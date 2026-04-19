import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { DEPARTMENTS, EMPLOYEES } from '../data/employees';

const inputSchema = {
  department: z.enum(DEPARTMENTS).optional().describe('Filter by department'),
  status: z.enum(['active', 'on-leave', 'offboarding']).optional().describe('Filter by employment status'),
};

const outputSchema = z
  .object({
    employees: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        department: z.string(),
        role: z.string(),
        location: z.string(),
        status: z.string(),
      }),
    ),
    employeeCount: z.number(),
    departments: z.array(z.string()),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'employee_directory',
  description:
    'Browse the employee directory with optional filters by department and status. Returns structured employee data.',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    resourceMode: 'cdn',
    widgetDescription: 'Displays an employee directory as a styled table with status badges.',
    template: {
      file: 'apps/e2e/demo-e2e-hr/src/apps/hr/tools/directory-ui.tsx',
      exportName: 'DirectoryTableWithHooks',
    },
  },
})
export default class EmployeeDirectoryTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    let filtered = EMPLOYEES;
    if (input.department) filtered = filtered.filter((e) => e.department === input.department);
    if (input.status) filtered = filtered.filter((e) => e.status === input.status);

    const departments = [...new Set(filtered.map((e) => e.department))];

    const employees = filtered.map((e) => ({
      id: e.id,
      name: e.name,
      department: e.department,
      role: e.role,
      location: e.location,
      status: e.status,
    }));

    return {
      employees,
      employeeCount: filtered.length,
      departments,
    };
  }
}
