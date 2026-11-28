import type { Token } from '@frontmcp/di';

import type { SharedLifecycle } from './provider.lifecycle';

/**
 * What a server started on a container (`@FrontMcp({ container })`) reads from it: the instances it built, and their
 * lifecycles, which the server's registries share, so the container's providers are built, bootstrapped and shut down
 * once, whatever starts on it.
 */
export interface ContainerHandle {
  /** The GLOBAL instances of the server-level providers, by token. */
  readonly server: ReadonlyMap<Token, unknown>;
  /** The GLOBAL instances of each app's own providers, by app class. */
  readonly apps: ReadonlyMap<unknown, ReadonlyMap<Token, unknown>>;
  /** The lifecycle bookkeeping of the container's providers: the first holder bootstraps one, the last shuts it down. */
  readonly lifecycles: WeakMap<object, SharedLifecycle>;
  /** The lifecycle hooks the container bootstrapped, its `@Duty` and `@Worker` lifecycles included. */
  readonly owned: WeakSet<object>;
  /** Each instance's `onReady()` run, by the first server on the container that serves; the others wait for it. */
  readonly readied: WeakMap<object, Promise<unknown[]>>;
  /** Whether the container started its `@Duty` and `@Worker` providers itself (`runBackground`). */
  readonly backgroundStarted: boolean;
  /** Whether the container's `dispose()` was called. */
  readonly disposed: boolean;
}

/** The property of a container that holds its handle; not enumerable. */
export const CONTAINER_HANDLE = Symbol.for('frontmcp:container-handle');

/** The handle of a container `createContainer()` made, or undefined for any other value. */
export function containerHandleOf(value: unknown): ContainerHandle | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as { [CONTAINER_HANDLE]?: ContainerHandle })[CONTAINER_HANDLE];
}
