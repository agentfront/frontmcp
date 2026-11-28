import { z } from '@frontmcp/lazy-zod';

import type { FrontMcpContext } from '../../context/frontmcp-context';
import type { ErrorRemedy } from '../../errors/mcp.error';

/**
 * A live on/off switch for a tool, resource, resource template or prompt (`enabled`).
 * `get` answers for a request (its context, when there is one); `subscribe` calls the listener whenever the
 * answer may have changed and returns the function that stops it.
 */
export interface EnabledSource {
  get(context?: FrontMcpContext): boolean | Promise<boolean>;
  subscribe(listener: () => void): () => void;
  /** How the caller turns the entry back on, sent with the `FEATURE_OFF` refusal. */
  readonly remedy?: ErrorRemedy;
  /**
   * What a `get` that throws counts as: `'off'` (the default, fail closed) leaves the entry out and refuses it,
   * `'on'` (fail open) keeps it listed and callable. The failure is logged either way.
   */
  readonly onError?: 'off' | 'on';
}

/** `enabled` on an entry: a fixed answer, or an {@link EnabledSource} that can change while sessions are live. */
export type EnabledOption = boolean | EnabledSource;

/** The kinds of entry `enabled` switches. */
export type EnabledEntryKind = 'tool' | 'resource' | 'resourceTemplate' | 'prompt';

/** An entry as the server's `enabled` resolver sees it. */
export interface EnabledEntryRef {
  readonly kind: EnabledEntryKind;
  /** The name it declares. */
  readonly name: string;
  /** Its name with its app's id first (`billing:invoice_list`). */
  readonly fullName: string;
  /** A resource's URI. */
  readonly uri?: string;
  /** A resource template's URI template. */
  readonly uriTemplate?: string;
  /** What declares it: its app, plugin, adapter or agent, by kind and id. */
  readonly owner?: { readonly kind: string; readonly id: string };
  /** The metadata it declares (`tags`, `annotations`, ...), to read only. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * The server's `enabled`: maps an entry to its switch in one place, by kind, name or URI. `undefined` leaves the
 * entry to its own `enabled`. Called once per entry; an entry is on only when its own `enabled` and this answer
 * are both on.
 */
export type EnabledResolver = (entry: EnabledEntryRef) => EnabledOption | undefined;

export function isEnabledSource(value: unknown): value is EnabledSource {
  const candidate = value as Partial<EnabledSource> | null | undefined;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.get === 'function' &&
    typeof candidate.subscribe === 'function'
  );
}

export const enabledOptionSchema = z.union([
  z.boolean(),
  z.custom<EnabledSource>(isEnabledSource, {
    message:
      '`enabled` must be a boolean or an EnabledSource ({ get(ctx), subscribe(listener) }), such as fileSignal()',
  }),
]);
