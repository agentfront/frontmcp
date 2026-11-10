import { InternalMcpError } from './mcp.error';

/** Thrown when a worker starts with the lease of a worker of another class in this process: one would never run. */
export class WorkerNameConflictError extends InternalMcpError {
  constructor(workerName: string, serverName: string, firstClass: string, secondClass: string) {
    super(
      `Worker "${workerName}" of server "${serverName}" is declared by two classes in this process (${firstClass} ` +
        `and ${secondClass}): give one of them its own name with @Worker({ name })`,
      'WORKER_NAME_CONFLICT',
    );
  }
}
