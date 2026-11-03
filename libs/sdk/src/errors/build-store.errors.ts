import { InternalMcpError } from './mcp.error';

/** Thrown when a store that a build left unopened is used: a build boots the server only to read it (#1041). */
export class StoreNotOpenedInBuildError extends InternalMcpError {
  readonly store: string;

  constructor(store: string) {
    super(
      `${store} is not opened while a build reads the server: it opens when the server starts`,
      'STORE_NOT_OPENED_IN_BUILD',
    );
    this.store = store;
  }
}
