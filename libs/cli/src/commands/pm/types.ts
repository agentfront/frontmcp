/**
 * Process Manager types for FrontMCP CLI.
 */

export interface PidFileData {
  pid: number;
  name: string;
  entry: string;
  port?: number;
  socketPath?: string;
  dbPath?: string;
  startedAt: string; // ISO 8601
  restartCount: number;
  supervisorPid: number;
  cliVersion: string;
}

export interface StartOptions {
  name: string;
  entry: string;
  port?: number;
  socket?: boolean;
  socketPath?: string;
  dbPath?: string;
  maxRestarts?: number;
  env?: Record<string, string>;
}

export interface ProcessInfo {
  name: string;
  pid: number;
  supervisorPid: number;
  status: 'running' | 'stopped' | 'dead';
  entry: string;
  port?: number;
  socketPath?: string;
  dbPath?: string;
  startedAt: string;
  restartCount: number;
  uptime: string;
  cliVersion: string;
}

export interface StopOptions {
  force?: boolean;
  timeout?: number;
}

export interface LogsOptions {
  follow?: boolean;
  lines?: number;
}

export type ServicePlatform = 'launchd' | 'systemd';
