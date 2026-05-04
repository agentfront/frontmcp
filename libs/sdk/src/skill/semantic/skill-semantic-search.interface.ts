// file: libs/sdk/src/skill/semantic/skill-semantic-search.interface.ts
//
// Extension point for plugging a semantic-search backend into the Skills HTTP
// API. The SDK ships only the *interface* and a safe fallback (text search)
// — no embeddings model is bundled. Hosts that want vector search wire a
// concrete provider (e.g. an OpenAI-embeddings adapter, an in-memory cosine
// similarity store, or a managed vector DB) into the DI container under the
// `SkillSemanticSearchToken` symbol.
//
// When no provider is registered, the HTTP flow falls back to the existing
// text search and emits a `Warning: 199 - "semantic-fallback"` HTTP header
// plus a structured `warning` field in the JSON response so clients can tell
// they didn't get true semantic results.

import type { Token } from '@frontmcp/di';

import type { SkillContent } from '../../common/interfaces/skill.interface';

/**
 * Pluggable semantic-search backend for the skills HTTP API.
 *
 * Implementations may keep their index in-memory, persist to a vector DB, or
 * delegate to a managed service. The SDK only ever calls these methods
 * through the DI token — the host owns the lifecycle.
 */
export interface SkillSemanticSearchProvider {
  /** Stable name (used in warning messages and traces). */
  readonly name: string;

  /**
   * Add or replace a skill in the index. Called from
   * `SkillRegistry.registerSkillContent` after the in-memory state is mutated
   * so the index is always at least eventually consistent.
   */
  index(skillId: string, content: SkillContent): Promise<void>;

  /**
   * Remove a skill from the index. Called from `unregisterSkill`.
   */
  remove(skillId: string): Promise<void>;

  /**
   * Search for the top-K skills matching `query`. Returns sorted results
   * (highest score first); the HTTP flow then applies category/min-rating/
   * tags/tools filters on top of these.
   */
  search(query: string, limit: number): Promise<{ skillId: string; score: number }[]>;

  /** Optional teardown hook fired on scope dispose. */
  dispose?(): Promise<void>;
}

/**
 * DI token for the host-supplied semantic-search provider. Resolved lazily
 * by the skills HTTP flow via `tryGet` so absent providers fall back to
 * text search rather than throwing.
 */
export const SkillSemanticSearchToken: Token<SkillSemanticSearchProvider> = Symbol.for(
  'frontmcp:SKILL_SEMANTIC_SEARCH',
) as Token<SkillSemanticSearchProvider>;
