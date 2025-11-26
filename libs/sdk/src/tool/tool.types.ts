import { EntryLineage, Token } from '../common';
import { ToolInstance } from './tool.instance';
import ToolRegistry from './tool.registry';
import type { NameCase } from '../utils/naming.utils';

/** Internal augmented row: instance + provenance + token */
export type IndexedTool = {
  token: Token;
  instance: ToolInstance;
  /** base tool name from metadata (unmodified) */
  baseName: string;
  /** lineage & qualified info */
  lineage: EntryLineage;
  ownerKey: string; // "app:Portal/plugin:Okta"
  qualifiedName: string; // "app:Portal/plugin:Okta:toolName"
  qualifiedId: string; // "app:Portal/plugin:Okta:tokenName(<token>)"
  /** which registry constructed the instance (the "owner" registry) */
  source: ToolRegistry;
};
export type ExportNameOptions = {
  case?: NameCase; // default 'snake'
  maxLen?: number; // default 64
  prefixChildrenOnConflict?: boolean; // default true
  prefixSource?: 'provider' | 'owner'; // default 'provider'
};

export const DEFAULT_EXPORT_OPTS: Required<ExportNameOptions> = {
  case: 'snake',
  maxLen: 64,
  prefixChildrenOnConflict: true,
  prefixSource: 'provider',
};
