import React from 'react';
import { Card, Badge } from '@frontmcp/ui/components';
import { useToolInput, useToolOutput, useTheme, useMcpBridgeContext } from '@frontmcp/ui/react';

interface EmployeeRow {
  id: string;
  name: string;
  department: string;
  role: string;
  location: string;
  status: string;
}

interface DirectoryInput {
  department?: string;
  status?: string;
}

interface DirectoryOutput {
  employees: EmployeeRow[];
  employeeCount: number;
  departments: string[];
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
  active: 'success',
  'on-leave': 'warning',
  offboarding: 'error',
};

interface DirectoryTableProps {
  input?: DirectoryInput;
  output?: DirectoryOutput;
  structuredContent?: DirectoryOutput;
}

export function DirectoryTableWithHooks({
  input: ssrInput,
  output: ssrOutput,
  structuredContent,
}: DirectoryTableProps = {}) {
  const { ready } = useMcpBridgeContext();
  const hookOutput = useToolOutput<DirectoryOutput>();
  const output = structuredContent ?? ssrOutput ?? hookOutput;

  const hookInput = useToolInput<DirectoryInput>();
  const input = ssrInput ?? hookInput;

  const theme = useTheme();
  const cardElevation = theme === 'dark' ? 3 : 1;

  if (!output || !output.employees) {
    return (
      <Card title="Employee Directory" elevation={cardElevation}>
        <div className="text-center py-6">
          <div className="text-5xl font-light text-text-primary mb-3">--</div>
          <p className="text-sm text-text-secondary">No employee data available</p>
        </div>
      </Card>
    );
  }

  const { employees, employeeCount, departments } = output;
  const title = input?.department ? `${input.department} Employees` : 'All Employees';
  const subtitle = input?.status ? ` (${input.status})` : '';

  return (
    <Card title={`${title}${subtitle}`} subtitle={`${employeeCount} employees found`} elevation={cardElevation}>
      <div className="py-2">
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontSize: 14,
          }}
        >
          <thead>
            <tr>
              {['ID', 'Name', 'Department', 'Role', 'Location', 'Status'].map((h) => (
                <th
                  key={h}
                  style={{
                    border: '1px solid var(--border-color, #ddd)',
                    padding: '10px 12px',
                    background: 'var(--bg-secondary, #f4f4f4)',
                    fontWeight: 600,
                    textAlign: 'left',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td style={cellStyle}>
                  <span style={{ fontFamily: 'monospace' }}>{emp.id}</span>
                </td>
                <td style={{ ...cellStyle, fontWeight: 500 }}>{emp.name}</td>
                <td style={cellStyle}>{emp.department}</td>
                <td style={cellStyle}>{emp.role}</td>
                <td style={cellStyle}>{emp.location}</td>
                <td style={cellStyle}>
                  <Badge variant={STATUS_VARIANT[emp.status] ?? 'info'} size="small" label={emp.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 pt-4 border-t border-divider">
          <details className="text-xs text-text-secondary">
            <summary className="cursor-pointer hover:text-text-primary">Debug Info</summary>
            <pre className="mt-2 p-2 bg-bg-secondary rounded text-left overflow-x-auto">
              {JSON.stringify({ input, output, theme, ready }, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Card>
  );
}

const cellStyle: React.CSSProperties = {
  border: '1px solid var(--border-color, #ddd)',
  padding: '8px 12px',
};

export default DirectoryTableWithHooks;
