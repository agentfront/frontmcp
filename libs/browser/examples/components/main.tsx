/**
 * FrontMCP Browser - Component Registration Example
 *
 * This example demonstrates:
 * - Registering React components for AI discovery
 * - Using useRegisterComponent hook
 * - AI-driven component rendering via tools
 * - Component schemas with Zod-like validation
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserMcpServer, createMcpStore } from '@frontmcp/browser';
import {
  FrontMcpProvider,
  useStore,
  useMcp,
  useRegisterComponent,
  useRegisteredComponents,
  UIResourceRenderer,
  useUIResource,
} from '@frontmcp/browser/react';
import type { AppState, TableData, ChartData, FormField } from './types';

// =============================================================================
// Store Setup
// =============================================================================

const store = createMcpStore<AppState>({
  initialState: {
    users: [
      { id: '1', name: 'Alice', email: 'alice@example.com', role: 'Admin', status: 'active' },
      { id: '2', name: 'Bob', email: 'bob@example.com', role: 'User', status: 'active' },
      { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'User', status: 'inactive' },
    ],
    chartData: null,
    formData: {},
    lastAction: 'initialized',
  },
});

// =============================================================================
// Server Setup
// =============================================================================

const server = new BrowserMcpServer({
  name: 'component-registration-example',
  store,
});

// =============================================================================
// Reusable Components for Registration
// =============================================================================

interface DataTableProps {
  data: TableData[];
  columns: (keyof TableData)[];
  onRowClick?: (row: TableData) => void;
}

function DataTable({ data, columns, onRowClick }: DataTableProps) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col}>{col.charAt(0).toUpperCase() + col.slice(1)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.id} onClick={() => onRowClick?.(row)}>
            {columns.map((col) => (
              <td key={col}>{row[col]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface StatCardProps {
  title: string;
  value: number | string;
  icon?: string;
  trend?: 'up' | 'down' | 'neutral';
}

function StatCard({ title, value, icon, trend = 'neutral' }: StatCardProps) {
  const trendColors = {
    up: '#28a745',
    down: '#dc3545',
    neutral: '#6c757d',
  };

  return (
    <div className="stat-card">
      {icon && <span className="stat-icon">{icon}</span>}
      <div className="stat-content">
        <div className="stat-value">{value}</div>
        <div className="stat-title">{title}</div>
      </div>
      {trend !== 'neutral' && <span style={{ color: trendColors[trend] }}>{trend === 'up' ? '↑' : '↓'}</span>}
    </div>
  );
}

interface AlertBoxProps {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
}

function AlertBox({ type, message, dismissible, onDismiss }: AlertBoxProps) {
  const colors = {
    info: { bg: '#e3f2fd', border: '#2196f3', text: '#1565c0' },
    success: { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32' },
    warning: { bg: '#fff3e0', border: '#ff9800', text: '#ef6c00' },
    error: { bg: '#ffebee', border: '#f44336', text: '#c62828' },
  };

  const style = colors[type];

  return (
    <div
      className="alert-box"
      style={{
        background: style.bg,
        borderLeft: `4px solid ${style.border}`,
        color: style.text,
      }}
    >
      <span>{message}</span>
      {dismissible && (
        <button onClick={onDismiss} className="dismiss-btn">
          ×
        </button>
      )}
    </div>
  );
}

// =============================================================================
// Component Registry Demo
// =============================================================================

function ComponentRegistryDemo() {
  const components = useRegisteredComponents();

  // Register DataTable component
  useRegisterComponent({
    name: 'DataTable',
    description: 'Display tabular data with customizable columns',
    propsSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array of data objects' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Column keys to display' },
      },
      required: ['data', 'columns'],
    },
    render: (props: DataTableProps) => <DataTable {...props} />,
    category: 'display',
    tags: ['table', 'data', 'list'],
  });

  // Register StatCard component
  useRegisterComponent({
    name: 'StatCard',
    description: 'Display a statistic with optional trend indicator',
    propsSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Stat label' },
        value: { type: 'string', description: 'Stat value' },
        icon: { type: 'string', description: 'Optional emoji icon' },
        trend: { type: 'string', enum: ['up', 'down', 'neutral'] },
      },
      required: ['title', 'value'],
    },
    render: (props: StatCardProps) => <StatCard {...props} />,
    category: 'display',
    tags: ['stat', 'metric', 'card'],
  });

  // Register AlertBox component
  useRegisterComponent({
    name: 'AlertBox',
    description: 'Display an alert message with different severity levels',
    propsSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['info', 'success', 'warning', 'error'] },
        message: { type: 'string', description: 'Alert message' },
        dismissible: { type: 'boolean', description: 'Show dismiss button' },
      },
      required: ['type', 'message'],
    },
    render: (props: AlertBoxProps) => <AlertBox {...props} />,
    category: 'feedback',
    tags: ['alert', 'notification', 'message'],
  });

  return (
    <div className="card">
      <h2>Registered Components</h2>
      <p className="description">These components are registered and discoverable by AI agents via MCP resources.</p>
      <div className="component-list">
        {components.map((comp) => (
          <div key={comp.name} className="component-item">
            <div className="component-name">{comp.name}</div>
            <div className="component-desc">{comp.description}</div>
            <div className="component-tags">
              {comp.tags?.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Live Component Demos
// =============================================================================

function LiveDemos() {
  const { state } = useStore<AppState>();
  const [alert, setAlert] = React.useState<{ type: AlertBoxProps['type']; message: string } | null>(null);

  return (
    <div className="card">
      <h2>Live Component Demos</h2>

      <h3>DataTable</h3>
      <DataTable
        data={state.users}
        columns={['name', 'email', 'role', 'status']}
        onRowClick={(row) => setAlert({ type: 'info', message: `Clicked: ${row.name}` })}
      />

      <h3>StatCards</h3>
      <div className="stat-grid">
        <StatCard title="Total Users" value={state.users.length} icon="👥" trend="up" />
        <StatCard
          title="Active Users"
          value={state.users.filter((u) => u.status === 'active').length}
          icon="✓"
          trend="up"
        />
        <StatCard
          title="Inactive Users"
          value={state.users.filter((u) => u.status === 'inactive').length}
          icon="⏸"
          trend="down"
        />
      </div>

      <h3>AlertBox</h3>
      <div className="alert-demos">
        <AlertBox type="info" message="This is an informational message." />
        <AlertBox type="success" message="Operation completed successfully!" />
        <AlertBox type="warning" message="Please review before proceeding." />
        <AlertBox
          type="error"
          message="An error occurred. Please try again."
          dismissible
          onDismiss={() => console.log('Dismissed')}
        />
      </div>

      {alert && (
        <div style={{ marginTop: '20px' }}>
          <AlertBox type={alert.type} message={alert.message} dismissible onDismiss={() => setAlert(null)} />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MCP Integration Panel
// =============================================================================

function McpIntegrationPanel() {
  const { server } = useMcp();
  const [resources, setResources] = React.useState<{ uri: string; name: string }[]>([]);
  const [selectedUri, setSelectedUri] = React.useState<string | null>(null);
  const [resourceData, setResourceData] = React.useState<string | null>(null);

  React.useEffect(() => {
    const list = server.getResources();
    setResources(list);
  }, [server]);

  const handleReadResource = async (uri: string) => {
    setSelectedUri(uri);
    try {
      const result = await server.readResource(uri);
      const text = result.contents[0]?.text || JSON.stringify(result, null, 2);
      setResourceData(text);
    } catch (err) {
      setResourceData(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="card">
      <h2>MCP Resources</h2>
      <p className="description">AI agents can discover registered components via these resources.</p>
      <div className="resource-list">
        {resources.map((r) => (
          <button
            key={r.uri}
            onClick={() => handleReadResource(r.uri)}
            className={selectedUri === r.uri ? 'active' : ''}
          >
            {r.name}
          </button>
        ))}
      </div>
      {resourceData && (
        <div className="resource-output">
          <h4>{selectedUri}</h4>
          <pre>{resourceData}</pre>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main App
// =============================================================================

function App() {
  return (
    <div className="app">
      <header>
        <h1>FrontMCP - Component Registration</h1>
        <p>Register React components for AI discovery and rendering</p>
      </header>

      <main>
        <ComponentRegistryDemo />
        <LiveDemos />
        <McpIntegrationPanel />
      </main>
    </div>
  );
}

// =============================================================================
// Render
// =============================================================================

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <FrontMcpProvider server={server}>
      <App />
    </FrontMcpProvider>
  </React.StrictMode>,
);
