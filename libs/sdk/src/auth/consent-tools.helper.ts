// auth/consent-tools.helper.ts
import { type ToolCard } from '@frontmcp/auth';

import { type ScopeEntry } from '../common';

/**
 * Result of projecting the scope's tools into a consent-ready shape.
 */
export interface ConsentToolProjection {
  /** Tool cards for the consent screen, with `excludedTools` removed. */
  toolCards: ToolCard[];
  /**
   * The offerable tool ids (effective runtime ids), with `excludedTools`
   * removed. This is what the consent screen offers and what a submitted
   * selection is validated against.
   */
  availableToolIds: string[];
}

/**
 * Effective runtime identifier for a tool.
 *
 * Mirrors `ToolInstance` (`name = metadata.id ?? metadata.name`,
 * `fullName = owner.id:name`). The consent screen and the runtime enforcement
 * MUST agree on this id, so the value stored in the token's `consent` claim is
 * the same value `call-tool` checks against. We use the bare effective name
 * (not the app-prefixed `fullName`) because that is the historical
 * `availableToolIds` shape; `call-tool` matches against both `name` and
 * `fullName`, so either is accepted.
 */
function effectiveToolId(metadata: { id?: string; name: string }): string {
  return metadata.id ?? metadata.name;
}

/**
 * Project the scope's tools into consent cards + available ids, applying the
 * `excludedTools` filter (excluded tools are NEVER offered and NEVER required,
 * because they are always available regardless of consent).
 *
 * Used by BOTH the authorize flow (to seed `pendingAuth.consent.availableToolIds`)
 * and the callback flow (to render the consent screen + validate a submission),
 * so the two surfaces can never drift.
 */
export function projectConsentTools(scope: ScopeEntry, excludedTools?: string[]): ConsentToolProjection {
  const excluded = new Set(excludedTools ?? []);
  const apps = scope.apps.getApps();
  const appNameById = new Map<string, string>();
  for (const app of apps) {
    // Real AppEntry exposes a top-level `id`; fall back to `metadata.id` so the
    // map keys line up with a tool's `owner.id` regardless of the app shape.
    const appId = app.id ?? app.metadata?.id;
    if (appId) appNameById.set(appId, app.metadata?.name ?? appId);
  }

  const toolCards: ToolCard[] = [];
  const availableToolIds: string[] = [];

  for (const tool of scope.tools.getTools()) {
    const id = effectiveToolId(tool.metadata);
    // Exclude by effective id (matches the documented `excludedTools` contract).
    if (excluded.has(id)) continue;

    const appId = tool.owner?.id ?? 'app';
    toolCards.push({
      toolId: id,
      toolName: tool.metadata.name,
      description: tool.metadata.description,
      appId,
      appName: appNameById.get(appId) ?? appId,
    });
    availableToolIds.push(id);
  }

  return { toolCards, availableToolIds };
}
