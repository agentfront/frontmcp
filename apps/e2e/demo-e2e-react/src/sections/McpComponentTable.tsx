import React from 'react';
import { z } from 'zod';
import { mcpComponent, useCallTool } from '@frontmcp/react';
import type { CallToolResult } from '@frontmcp/react';

interface UsersTableProps {
  rows: Array<{ name: string; age: number; role: string }>;
}

function UsersTable({ rows }: UsersTableProps): React.ReactElement {
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Age</th>
          <th>Role</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td>{row.name}</td>
            <td>{row.age}</td>
            <td>{row.role}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const McpUsersTable = mcpComponent(UsersTable, {
  name: 'show_users_table',
  description: 'Shows a table of users',
  schema: z.object({
    rows: z.array(
      z.object({
        name: z.string(),
        age: z.number(),
        role: z.string(),
      }),
    ),
  }),
  fallback: <div data-testid="table-fallback">Waiting for table data...</div>,
});

export function McpComponentTable(): React.ReactElement {
  const [callShowTable] = useCallTool<UsersTableProps, CallToolResult>('show_users_table');

  const handleTrigger = async () => {
    await callShowTable({
      rows: [
        { name: 'Alice', age: 30, role: 'Engineer' },
        { name: 'Bob', age: 25, role: 'Designer' },
      ],
    });
  };

  return (
    <div>
      <h2>MCP Component Table</h2>
      <button data-testid="table-trigger" onClick={handleTrigger}>
        Show Users Table
      </button>
      <div data-testid="table-container">
        <McpUsersTable />
      </div>
    </div>
  );
}
