import { InternalMcpError } from './mcp.error';

/** Thrown by `runShared()` when its options are invalid, before it attaches to or starts anything. */
export class InvalidSharedServerOptionsError extends InternalMcpError {
  constructor(issues: string) {
    super(`runShared() options are invalid: ${issues}`, 'INVALID_SHARED_SERVER_OPTIONS');
  }
}

/** Thrown when another user could replace or read the files of a shared local server. */
export class UnsafeSharedServerDirectoryError extends InternalMcpError {
  constructor(target: string, mode: number, reason: string) {
    super(
      `Refusing to keep the shared server's files under ${target} (mode 0${(mode & 0o7777).toString(8)}): ${reason}. ` +
        'Set FRONTMCP_HOME to a folder only you can write to.',
      'UNSAFE_SHARED_SERVER_DIRECTORY',
    );
  }
}

/** Thrown when a session can't attach to its shared server: none proved its identity, or the one it started exited. */
export class SharedServerStartError extends InternalMcpError {
  constructor(key: string, reason: string) {
    super(`The shared server "${key}" did not start: ${reason}`, 'SHARED_SERVER_START_FAILED');
  }
}

/** Thrown instead of a request when the process on a shared server's loopback port can't prove it is the server. */
export class SharedServerIdentityError extends InternalMcpError {
  constructor(endpoint: string) {
    super(`The process at ${endpoint} did not prove it is the shared server`, 'SHARED_SERVER_IDENTITY_REFUSED');
  }
}
