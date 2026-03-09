import React from 'react';
import { Card, Badge } from '@frontmcp/ui/components';
import { useToolInput, useToolOutput, useTheme, useMcpBridgeContext } from '@frontmcp/ui/react';

interface EmployeeData {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  startDate: string;
  status: string;
  location: string;
}

interface ProfileInput {
  employeeId: string;
}

interface ProfileOutput {
  employee: EmployeeData;
  tenure: string;
  salaryRange: string;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
  active: 'success',
  'on-leave': 'warning',
  offboarding: 'error',
};

interface ProfileCardProps {
  input?: ProfileInput;
  output?: ProfileOutput;
  structuredContent?: ProfileOutput;
}

export function ProfileCardWithHooks({ input: ssrInput, output: ssrOutput, structuredContent }: ProfileCardProps = {}) {
  const { ready } = useMcpBridgeContext();
  const hookOutput = useToolOutput<ProfileOutput>();
  const output = structuredContent ?? ssrOutput ?? hookOutput;

  const hookInput = useToolInput<ProfileInput>();
  const input = ssrInput ?? hookInput;

  const theme = useTheme();
  const cardElevation = theme === 'dark' ? 3 : 1;

  if (!output || !output.employee) {
    return (
      <Card title="Employee Profile" elevation={cardElevation}>
        <div className="text-center py-6">
          <div className="text-5xl font-light text-text-primary mb-3">--</div>
          <p className="text-sm text-text-secondary">No employee data available</p>
        </div>
      </Card>
    );
  }

  const { employee, tenure, salaryRange } = output;
  const statusVariant = STATUS_VARIANT[employee.status] ?? 'info';

  const initials = employee.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  return (
    <Card
      title={employee.name}
      subtitle={employee.role}
      elevation={cardElevation}
      footer={
        <div className="flex justify-between items-center">
          <p className="text-xs text-text-secondary">ID: {employee.id}</p>
          <Badge variant={statusVariant} size="small" label={employee.status} />
        </div>
      }
    >
      <div className="py-4">
        {/* Avatar + Name */}
        <div className="flex items-center gap-4 mb-4">
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            {initials}
          </div>
          <div>
            <div className="text-lg font-semibold text-text-primary">{employee.name}</div>
            <div className="text-sm text-text-secondary">{employee.email}</div>
          </div>
        </div>

        {/* Details Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
          }}
        >
          <DetailItem label="Department" value={employee.department} />
          <DetailItem label="Location" value={employee.location} />
          <DetailItem label="Tenure" value={tenure} />
          <DetailItem label="Start Date" value={employee.startDate} />
          <DetailItem label="Salary Band" value={salaryRange} />
          <DetailItem label="Status" value={employee.status} />
        </div>
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

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-text-secondary mb-1">{label}</div>
      <div className="text-sm font-medium text-text-primary">{value}</div>
    </div>
  );
}

export default ProfileCardWithHooks;
