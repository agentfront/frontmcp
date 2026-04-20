import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { EMPLOYEES, SALARY_BANDS } from '../data/employees';

const inputSchema = {
  employeeId: z.string().describe('Employee ID (e.g. E001)'),
};

const outputSchema = z
  .object({
    employee: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      department: z.string(),
      role: z.string(),
      startDate: z.string(),
      status: z.string(),
      location: z.string(),
    }),
    tenure: z.string(),
    salaryRange: z.string(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'employee_profile',
  description: 'View a detailed employee profile card with tenure and salary information.',
  inputSchema,
  outputSchema,
  annotations: {
    title: 'Employee Profile',
    readOnlyHint: true,
  },
  ui: {
    template: {
      file: 'apps/e2e/demo-e2e-hr/src/apps/hr/tools/profile-ui.tsx',
      exportName: 'ProfileCardWithHooks',
    },
    widgetDescription: 'Displays an employee profile card with status badges and details.',
    displayMode: 'inline',
    widgetAccessible: true,
    servingMode: 'auto',
    resourceMode: 'cdn',
  },
})
export default class EmployeeProfileTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const emp = EMPLOYEES.find((e) => e.id === input.employeeId);
    if (!emp) {
      throw new Error(`Employee not found: ${input.employeeId}`);
    }

    const start = new Date(emp.startDate);
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    const years = Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000));
    const months = Math.floor((diffMs % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000));
    const tenure = years > 0 ? `${years}y ${months}m` : `${months}m`;

    const band = SALARY_BANDS[emp.salaryBand];
    const salaryRange = band
      ? `$${(band.min / 1000).toFixed(0)}K - $${(band.max / 1000).toFixed(0)}K (${band.label})`
      : 'N/A';

    return {
      employee: {
        id: emp.id,
        name: emp.name,
        email: emp.email,
        department: emp.department,
        role: emp.role,
        startDate: emp.startDate,
        status: emp.status,
        location: emp.location,
      },
      tenure,
      salaryRange,
    };
  }
}
