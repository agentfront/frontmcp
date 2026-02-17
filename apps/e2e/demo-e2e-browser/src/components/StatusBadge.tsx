import type { FrontMcpStatus } from '@frontmcp/react';

const statusLabels: Record<FrontMcpStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting...',
  connected: 'Connected',
  error: 'Error',
};

export function StatusBadge({ status }: { status: FrontMcpStatus }) {
  return (
    <div className={`status-badge ${status}`}>
      <span className="dot" />
      <span>{statusLabels[status]}</span>
    </div>
  );
}
