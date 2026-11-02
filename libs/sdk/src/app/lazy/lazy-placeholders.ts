import type { ScopeEntry } from '../../common/entries/scope.entry';
import type { EnabledOption } from '../../common/metadata/enabled.metadata';
import type { FrontMcpContext } from '../../context/frontmcp-context';
import { FrontMcpContextStorage } from '../../context/frontmcp-context-storage';
import { LazyAppLoadError } from '../../errors/lazy-app.errors';
import { isEntryEnabled } from '../../surface/entry-enabled';

/** What a request needs from the lazy app a placeholder entry stands for. */
export interface LazyAppLoader {
  readonly metadata: { readonly name: string };
  /** Imports and initializes the app, once, however many callers wait for it. */
  load(): Promise<void>;
  /** Whether the next call imports the app again after a failed load. */
  readonly retryable: boolean;
}

const appOfPlaceholder = new WeakMap<object, LazyAppLoader>();

/** Mark `entry` as a placeholder of `app`, listed from the manifest until the app is loaded. */
export function markPlaceholder(entry: object, app: LazyAppLoader): void {
  appOfPlaceholder.set(entry, app);
}

/** The lazy app `entry` is a placeholder of, or undefined for an entry the app's code declares. */
export function lazyAppOf(entry: object): LazyAppLoader | undefined {
  return appOfPlaceholder.get(entry);
}

/**
 * Before a request's flow collects its hooks: import the lazy app `entry` stands for, when the entry is on, so the
 * request runs the app's own entry and the hooks the app adds. Returns whether the app was loaded for it; a failure
 * is answered by the flow's `checkAppLoaded` stage.
 */
export async function loadAppOfPlaceholder(
  scope: ScopeEntry,
  entry: { readonly metadata: { readonly enabled?: EnabledOption } },
): Promise<boolean> {
  const app = lazyAppOf(entry);
  if (!app || !(await isEntryEnabled(entry.metadata.enabled, requestContextOf(scope)))) return false;
  return app.load().then(
    () => true,
    () => false,
  );
}

function requestContextOf(scope: ScopeEntry): FrontMcpContext | undefined {
  try {
    return scope.providers.get(FrontMcpContextStorage).getStore();
  } catch {
    return undefined;
  }
}

/** The `checkAppLoaded` stage: an entry that is on and still a placeholder belongs to an app that failed to load. */
export function assertAppLoaded(entry: object): void {
  const app = lazyAppOf(entry);
  if (app) throw new LazyAppLoadError(app.metadata.name, app.retryable);
}
