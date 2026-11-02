import { sha256Hex } from '@frontmcp/utils';

import type { ListChangedKind } from '../common/interfaces/flow.interface';
import { isEnabledSource, type EnabledOption, type EnabledSource } from '../common/metadata/enabled.metadata';

/** The `_meta` key of a list result that carries the hash of what the list shows. */
export const SURFACE_META_KEY = 'frontmcp/surface';

const LIST_KINDS: readonly ListChangedKind[] = ['tools', 'resources', 'prompts'];

interface SurfaceRegistry {
  listAllInstances(): readonly { readonly metadata: { readonly enabled?: EnabledOption } }[];
  subscribe(options: { immediate?: boolean }, listener: () => void): () => void;
  notifyListChanged(): void;
}

/** What the live surface needs from its scope. */
export interface LiveSurfaceScope {
  readonly tools: SurfaceRegistry;
  readonly resources: SurfaceRegistry;
  readonly prompts: SurfaceRegistry;
  readonly notifications: {
    sendNotificationToSession(sessionId: string, method: 'notifications/tools/list_changed'): void;
  };
  readonly logger: { warn(message: string): void };
}

export interface LiveSurfaceOptions {
  /** How long changes are gathered into one `list_changed` per kind. Defaults to 100 ms. */
  windowMs?: number;
  /** How many sessions' last tool listing are remembered. Defaults to 10 000. */
  maxSessions?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A short hash of the names a list shows, in any order. */
export function surfaceHash(names: readonly string[]): string {
  return sha256Hex([...names].sort().join('\n')).slice(0, 16);
}

/**
 * The part of a scope's lists that changes while sessions are live: it follows the `enabled` sources of the
 * scope's entries and announces a change as one `list_changed` per kind per window, to every connected session.
 * It also remembers, per session, which version of the tool list the session last listed, so a call made against
 * an older list can be answered `STALE_TOOL_LIST`.
 */
export class LiveSurface {
  private readonly windowMs: number;
  private readonly maxSessions: number;
  private readonly sources = new Map<ListChangedKind, Map<EnabledSource, () => void>>();
  private readonly pending = new Map<ListChangedKind, ReturnType<typeof setTimeout>>();
  private readonly stops: Array<() => void> = [];
  /** The tool list's version: it moves on with every change of the tool registry. */
  private toolsVersion = 0;
  /** The tool list version each session last listed, least recently listed first. */
  private readonly listedVersions = new Map<string, number>();
  private running = false;

  constructor(
    private readonly scope: LiveSurfaceScope,
    options: LiveSurfaceOptions = {},
  ) {
    this.windowMs = options.windowMs ?? 100;
    this.maxSessions = options.maxSessions ?? 10_000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const kind of LIST_KINDS) {
      this.followSources(kind);
      this.stops.push(this.registryOf(kind).subscribe({ immediate: false }, () => this.followSources(kind)));
    }
    this.stops.push(this.scope.tools.subscribe({ immediate: false }, () => this.toolsVersion++));
  }

  stop(): void {
    this.running = false;
    for (const stop of this.stops.splice(0)) stop();
    for (const watched of this.sources.values()) for (const unsubscribe of watched.values()) unsubscribe();
    this.sources.clear();
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  /** Tell every connected session that the `kind` list changed, once per window. */
  listChanged(kind: ListChangedKind): void {
    if (!this.running || this.pending.has(kind)) return;
    const timer = setTimeout(() => {
      this.pending.delete(kind);
      try {
        this.registryOf(kind).notifyListChanged();
      } catch (error) {
        this.scope.logger.warn(`The ${kind} list change could not be announced: ${messageOf(error)}`);
      }
    }, this.windowMs);
    timer.unref?.();
    this.pending.set(kind, timer);
  }

  /** Remember that `sessionId` was just listed the tools `names`; returns their surface hash. */
  recordToolList(sessionId: string | undefined, names: readonly string[]): string {
    if (sessionId) {
      this.listedVersions.delete(sessionId);
      this.listedVersions.set(sessionId, this.toolsVersion);
      if (this.listedVersions.size > this.maxSessions) {
        const [leastRecent] = this.listedVersions.keys();
        this.listedVersions.delete(leastRecent);
      }
    }
    return surfaceHash(names);
  }

  /** Whether the tool list changed since `sessionId` last listed it. */
  isStale(sessionId: string | undefined): boolean {
    const listed = sessionId === undefined ? undefined : this.listedVersions.get(sessionId);
    return listed !== undefined && listed < this.toolsVersion;
  }

  /** Send `sessionId` a `tools/list_changed`, and answer it as current until the list changes again. */
  refreshSession(sessionId: string): void {
    if (this.listedVersions.has(sessionId)) this.listedVersions.set(sessionId, this.toolsVersion);
    this.scope.notifications.sendNotificationToSession(sessionId, 'notifications/tools/list_changed');
  }

  private registryOf(kind: ListChangedKind): SurfaceRegistry {
    return this.scope[kind];
  }

  /** Subscribe to the sources the `kind` entries use now, and let go of those no entry uses any more. */
  private followSources(kind: ListChangedKind): void {
    const used = new Set(
      this.registryOf(kind)
        .listAllInstances()
        .map((entry) => entry.metadata.enabled)
        .filter(isEnabledSource),
    );
    const watched = this.sources.get(kind) ?? new Map<EnabledSource, () => void>();
    this.sources.set(kind, watched);
    for (const [source, unsubscribe] of watched) {
      if (used.has(source)) continue;
      unsubscribe();
      watched.delete(source);
    }
    for (const source of used) {
      if (watched.has(source)) continue;
      try {
        watched.set(
          source,
          source.subscribe(() => this.listChanged(kind)),
        );
      } catch (error) {
        watched.set(source, () => undefined);
        this.scope.logger.warn(`An enabled source of the ${kind} could not be followed: ${messageOf(error)}`);
      }
    }
  }
}
