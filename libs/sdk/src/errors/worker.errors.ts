import { InternalMcpError } from './mcp.error';

/** Thrown when a worker starts with the name a worker of another class has in its server, whatever their scopes. */
export class WorkerNameConflictError extends InternalMcpError {
  /** Names the worker, its server and the two classes that declare it. */
  constructor(workerName: string, serverName: string, firstClass: string, secondClass: string) {
    super(
      `Worker "${workerName}" of server "${serverName}" is declared by two classes in this process (${firstClass} ` +
        `and ${secondClass}): give one of them its own name with @Worker({ name })`,
      'WORKER_NAME_CONFLICT',
    );
  }
}
