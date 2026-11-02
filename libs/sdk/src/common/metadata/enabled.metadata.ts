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
}

/** `enabled` on an entry: a fixed answer, or an {@link EnabledSource} that can change while sessions are live. */
export type EnabledOption = boolean | EnabledSource;

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
