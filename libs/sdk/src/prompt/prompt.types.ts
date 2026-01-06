// file: libs/sdk/src/prompt/prompt.types.ts

import { EntryLineage, PromptEntry, Token } from '../common';
import PromptRegistry from './prompt.registry';
import type { NameCase } from '@frontmcp/utils';

// Re-export NameCase as PromptNameCase for consistency
export type PromptNameCase = NameCase;

// ============================================================================
// Indexed Prompt (for registry internal use)
// ============================================================================

/** Internal augmented row: instance + provenance + token */
export type IndexedPrompt = {
  token: Token;
  /** The prompt entry (can be PromptInstance or remote proxy entry) */
  instance: PromptEntry;
  /** base prompt name from metadata (unmodified) */
  baseName: string;
  /** lineage & qualified info */
  lineage: EntryLineage;
  ownerKey: string; // "app:Portal/plugin:Okta"
  qualifiedName: string; // "app:Portal/plugin:Okta:promptName"
  qualifiedId: string; // "app:Portal/plugin:Okta:tokenName(<token>)"
  /** which registry constructed the instance (the "owner" registry) */
  source: PromptRegistry;
};

// ============================================================================
// Export Name Options
// ============================================================================

export type PromptExportOptions = {
  case?: PromptNameCase; // default 'snake'
  maxLen?: number; // default 64
  prefixChildrenOnConflict?: boolean; // default true
  prefixSource?: 'provider' | 'owner'; // default 'provider'
};

export const DEFAULT_PROMPT_EXPORT_OPTS: Required<PromptExportOptions> = {
  case: 'snake',
  maxLen: 64,
  prefixChildrenOnConflict: true,
  prefixSource: 'provider',
};
