/**
 * Table formatting for process status / list output.
 */

import { ProcessInfo } from './pm.types';
import { c } from '../colors';

export function formatProcessTable(processes: ProcessInfo[]): string {
  if (processes.length === 0) {
    return c('gray', 'No managed processes found.');
  }

  const headers = ['Name', 'PID', 'Status', 'Port', 'Uptime', 'Restarts'];
  const rows: string[][] = processes.map((p) => [
    p.name,
    String(p.pid),
    formatStatus(p.status),
    p.port ? String(p.port) : p.socketPath ? 'socket' : '-',
    p.status === 'running' ? p.uptime : '-',
    String(p.restartCount),
  ]);

  return formatTable(headers, rows);
}

function formatStatus(status: string): string {
  switch (status) {
    case 'running':
      return c('green', 'running');
    case 'stopped':
      return c('yellow', 'stopped');
    case 'dead':
      return c('red', 'dead');
    default:
      return c('gray', status);
  }
}

export function formatUptime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diff = now - start;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatTable(headers: string[], rows: string[][]): string {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => {
      const len = stripAnsi(row[i]).length;
      return len > max ? len : max;
    }, 0);
    return Math.max(stripAnsi(h).length, maxRow);
  });

  const separator = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  const headerLine = headers.map((h, i) => ` ${c('bold', padRight(h, widths[i]))} `).join('│');

  const bodyLines = rows.map((row) => row.map((cell, i) => ` ${padRight(cell, widths[i])} `).join('│'));

  return [headerLine, separator, ...bodyLines].join('\n');
}

function padRight(str: string, width: number): string {
  const visibleLen = stripAnsi(str).length;
  const padding = Math.max(0, width - visibleLen);
  return str + ' '.repeat(padding);
}

const ANSI_REGEX = new RegExp('\\x1b\\[[0-9;]*m', 'g');

function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function formatProcessDetail(p: ProcessInfo): string {
  const lines = [
    `${c('bold', 'Name:')}        ${p.name}`,
    `${c('bold', 'PID:')}         ${p.pid}`,
    `${c('bold', 'Supervisor:')}  ${p.supervisorPid}`,
    `${c('bold', 'Status:')}      ${formatStatus(p.status)}`,
    `${c('bold', 'Entry:')}       ${p.entry}`,
  ];

  if (p.port) lines.push(`${c('bold', 'Port:')}        ${p.port}`);
  if (p.socketPath) lines.push(`${c('bold', 'Socket:')}      ${p.socketPath}`);
  if (p.dbPath) lines.push(`${c('bold', 'Database:')}    ${p.dbPath}`);

  lines.push(`${c('bold', 'Started:')}     ${p.startedAt}`);
  lines.push(`${c('bold', 'Uptime:')}      ${p.status === 'running' ? p.uptime : '-'}`);
  lines.push(`${c('bold', 'Restarts:')}    ${p.restartCount}`);
  lines.push(`${c('bold', 'CLI Version:')} ${p.cliVersion}`);

  return lines.join('\n');
}
