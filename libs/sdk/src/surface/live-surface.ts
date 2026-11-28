import { sha256Hex } from '@frontmcp/utils';

import type { ListChangedKind } from '../common/interfaces/flow.interface';
import {
  isEnabledSource,
  type EnabledEntryKind,
  type EnabledEntryRef,
  type EnabledOption,
  type EnabledResolver,
  type EnabledSource,
} from '../common/metadata/enabled.metadata';
import { STATELESS_SESSION_ID } from '../transport/transport.types';
import type { EntrySwitches, SwitchedEntry } from './entry-enabled';
import { announcesListChangeNow } from './list-change-batch';

/** The `_meta` key of a list result that carries the hash of what the list shows. */
export const SURFACE_META_KEY = 'frontmcp/surface';

const LIST_KINDS: readonly ListChangedKind[] = ['tools', 'resources', 'prompts'];

/** An entry of a list, as the server's `enabled` resolver is told of it. */
export interface SurfaceEntry extends SwitchedEntry {
  readonly name?: string;
  readonly fullName?: string;
  readonly uri?: string;
  readonly uriTemplate?: string;
  readonly isTemplate?: boolean;
  readonly owner?: { readonly kind: string; readonly id: string };
}

interface SurfaceRegistry {
  listAllInstances(): readonly SurfaceEntry[];
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
    getRegisteredServer(sessionId: string): unknown;
  };
  readonly logger: { warn(message: string): void };
  /** The server's options; its `enabled` maps entries to their switch. */
  readonly metadata?: { readonly enabled?: EnabledResolver };
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

/** Whether `value` is something `enabled` takes: a boolean or an {@link EnabledSource}. */
function isEnabledOption(value: unknown): value is EnabledOption {
  return typeof value === 'boolean' || isEnabledSource(value);
}

/** The kind the server's `enabled` resolver is told for an entry of the `kind` list. */
function entryKindOf(kind: ListChangedKind, entry: SurfaceEntry): EnabledEntryKind {
  if (kind === 'tools') return 'tool';
  if (kind === 'prompts') return 'prompt';
  return entry.isTemplate ? 'resourceTemplate' : 'resource';
}

/** The entry as the server's `enabled` resolver sees it. */
function entryRefOf(kind: ListChangedKind, entry: SurfaceEntry): EnabledEntryRef {
  const name = entry.name ?? '';
  return {
    kind: entryKindOf(kind, entry),
    name,
    fullName: entry.fullName ?? name,
    ...(entry.uri !== undefined ? { uri: entry.uri } : {}),
    ...(entry.uriTemplate !== undefined ? { uriTemplate: entry.uriTemplate } : {}),
    ...(entry.owner ? { owner: { kind: entry.owner.kind, id: entry.owner.id } } : {}),
    metadata: entry.metadata as Readonly<Record<string, unknown>>,
  };
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
  /** What the server's `enabled` answered for each entry, asked once per entry. */
  private readonly serverSwitches = new WeakMap<object, EnabledOption | undefined>();
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
    this.stops.push(
      this.scope.tools.subscribe({ immediate: false }, () => {
        if (announcesListChangeNow(this.scope, 'tools')) this.toolsVersion++;
      }),
    );
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

  /**
   * The switches of an entry of the `kind` list: its own `enabled`, then the one the server's `enabled` maps it to.
   * The server's is asked once per entry; one that throws or answers something `enabled` does not take is off.
   */
  enabledOf(kind: ListChangedKind, entry: SurfaceEntry): EntrySwitches {
    const own = entry.metadata.enabled;
    const resolver = this.scope.metadata?.enabled;
    if (!resolver) return own;
    if (!this.serverSwitches.has(entry)) {
      this.serverSwitches.set(entry, this.resolveServerSwitch(resolver, kind, entry));
    }
    const server = this.serverSwitches.get(entry);
    return server === undefined ? own : [own, server];
  }

  /** Remember that `sessionId`, when connected here, was just listed the tools `names`; returns their surface hash. */
  recordToolList(sessionId: string | undefined, names: readonly string[]): string {
    if (this.isConnectedSession(sessionId)) {
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

  /**
   * Send `sessionId` a `tools/list_changed` when it is connected here, and answer it as current until the list
   * changes again. A 2026-07-28 or stateless request, or a session connected to another process, is sent nothing.
   */
  refreshSession(sessionId: string): void {
    if (this.listedVersions.has(sessionId)) this.listedVersions.set(sessionId, this.toolsVersion);
    if (!this.isConnectedSession(sessionId)) return;
    this.scope.notifications.sendNotificationToSession(sessionId, 'notifications/tools/list_changed');
  }

  /** The id of a 2026-07-28 or stateless request names that request, not a session that can be told of a change. */
  private isConnectedSession(sessionId: string | undefined): sessionId is string {
    if (!sessionId || sessionId === STATELESS_SESSION_ID) return false;
    return this.scope.notifications.getRegisteredServer(sessionId) !== undefined;
  }

  private registryOf(kind: ListChangedKind): SurfaceRegistry {
    return this.scope[kind];
  }

  /** What the server's `enabled` maps `entry` to; off, and logged, when it throws or answers something else. */
  private resolveServerSwitch(
    resolver: EnabledResolver,
    kind: ListChangedKind,
    entry: SurfaceEntry,
  ): EnabledOption | undefined {
    const ref = entryRefOf(kind, entry);
    const label = `${ref.kind} "${ref.uri ?? ref.uriTemplate ?? ref.fullName}"`;
    try {
      const answer = resolver(ref);
      if (answer === undefined || isEnabledOption(answer)) return answer;
      this.scope.logger.warn(
        `The server's enabled answered ${label} with something that is neither a boolean nor an EnabledSource, so it is off`,
      );
    } catch (error) {
      this.scope.logger.warn(`The server's enabled failed for ${label}, so it is off: ${messageOf(error)}`);
    }
    return false;
  }

  /** Subscribe to the sources the `kind` entries use now, and let go of those no entry uses any more. */
  private followSources(kind: ListChangedKind): void {
    const used = new Set(
      this.registryOf(kind)
        .listAllInstances()
        .flatMap((entry) => {
          const switches = this.enabledOf(kind, entry);
          return Array.isArray(switches) ? switches : [switches];
        })
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
