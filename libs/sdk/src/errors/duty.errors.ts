import { InternalMcpError } from './mcp.error';

/** Thrown when a duty starts with the lease of a duty of another class in this process: one of them would never run. */
export class DutyNameConflictError extends InternalMcpError {
  constructor(dutyName: string, serverName: string, firstClass: string, secondClass: string) {
    super(
      `Duty "${dutyName}" of server "${serverName}" is declared by two classes in this process (${firstClass} and ` +
        `${secondClass}): give one of them its own name with @Duty({ name })`,
      'DUTY_NAME_CONFLICT',
    );
  }
}

/** Thrown when another user could write to the folder that holds the duty lease file, or to one above it. */
export class UnsafeDutyStoreError extends InternalMcpError {
  constructor(directory: string, mode: number, ownerUid?: number) {
    const reason =
      ownerUid === undefined ? 'the group or others can write to it' : `it belongs to another user (uid ${ownerUid})`;
    super(
      `Refusing to keep duty leases under ${directory} (mode 0${(mode & 0o7777).toString(8)}): ${reason}. ` +
        'Set FRONTMCP_HOME to a folder only you can write to.',
      'UNSAFE_DUTY_STORE',
    );
  }
}
