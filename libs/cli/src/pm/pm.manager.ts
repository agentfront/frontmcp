/**
 * ProcessManager class — orchestrates all PM modules.
 */

import { readPidFile, isProcessAlive, listPidFiles, removePidFile } from './pm.pidfile';
import { formatUptime } from './pm.format';
import { Supervisor } from './pm.spawn';
import { StartOptions, StopOptions, ProcessInfo } from './pm.types';

// Track running supervisors in this process
const supervisors = new Map<string, Supervisor>();

export class ProcessManager {
  async start(opts: StartOptions): Promise<ProcessInfo> {
    // Check if already running
    const existing = readPidFile(opts.name);
    if (existing && isProcessAlive(existing.pid)) {
      throw new Error(
        `Process "${opts.name}" is already running (PID: ${existing.pid}). Stop it first with: frontmcp stop ${opts.name}`,
      );
    }

    // Clean up stale PID file
    if (existing) {
      removePidFile(opts.name);
    }

    const supervisor = new Supervisor(opts);
    await supervisor.start();
    supervisors.set(opts.name, supervisor);

    // Wait briefly for child to spawn
    await new Promise((resolve) => setTimeout(resolve, 500));

    const info = this.getProcessInfo(opts.name);
    if (!info) {
      throw new Error(`Failed to start process "${opts.name}"`);
    }
    return info;
  }

  async stop(name: string, opts: StopOptions = {}): Promise<void> {
    const supervisor = supervisors.get(name);
    if (supervisor) {
      await supervisor.stop(opts.force);
      supervisors.delete(name);
      return;
    }

    // No local supervisor — try to kill by PID file
    const pidData = readPidFile(name);
    if (!pidData) {
      throw new Error(`No process found with name "${name}"`);
    }

    if (!isProcessAlive(pidData.pid)) {
      removePidFile(name);
      throw new Error(`Process "${name}" is not running (stale PID file removed)`);
    }

    // Try graceful shutdown via supervisor PID first, then process PID
    const targetPid = pidData.supervisorPid || pidData.pid;

    if (opts.force) {
      try {
        process.kill(targetPid, 'SIGKILL');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
      }
    } else {
      try {
        process.kill(targetPid, 'SIGTERM');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
      }

      // Wait for process to exit
      const timeout = opts.timeout ?? 10000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (!isProcessAlive(pidData.pid)) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Force kill if still alive
      if (isProcessAlive(pidData.pid)) {
        try {
          process.kill(pidData.pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }

    removePidFile(name);
  }

  async restart(name: string): Promise<ProcessInfo> {
    const pidData = readPidFile(name);
    if (!pidData) {
      throw new Error(`No process found with name "${name}". Cannot restart.`);
    }

    // Stop existing
    try {
      await this.stop(name);
    } catch {
      // May already be stopped
    }

    // Restart with same config
    return this.start({
      name: pidData.name,
      entry: pidData.entry,
      port: pidData.port,
      socketPath: pidData.socketPath,
      dbPath: pidData.dbPath,
      socket: !!pidData.socketPath,
    });
  }

  getProcessInfo(name: string): ProcessInfo | null {
    const pidData = readPidFile(name);
    if (!pidData) return null;

    const alive = isProcessAlive(pidData.pid);

    return {
      name: pidData.name,
      pid: pidData.pid,
      supervisorPid: pidData.supervisorPid,
      status: alive ? 'running' : 'dead',
      entry: pidData.entry,
      port: pidData.port,
      socketPath: pidData.socketPath,
      dbPath: pidData.dbPath,
      startedAt: pidData.startedAt,
      restartCount: pidData.restartCount,
      uptime: alive ? formatUptime(pidData.startedAt) : '-',
      cliVersion: pidData.cliVersion,
    };
  }

  listAll(): ProcessInfo[] {
    const pidFiles = listPidFiles();
    return pidFiles.map((data) => {
      const alive = isProcessAlive(data.pid);
      return {
        name: data.name,
        pid: data.pid,
        supervisorPid: data.supervisorPid,
        status: alive ? 'running' : ('dead' as const),
        entry: data.entry,
        port: data.port,
        socketPath: data.socketPath,
        dbPath: data.dbPath,
        startedAt: data.startedAt,
        restartCount: data.restartCount,
        uptime: alive ? formatUptime(data.startedAt) : '-',
        cliVersion: data.cliVersion,
      };
    });
  }
}
