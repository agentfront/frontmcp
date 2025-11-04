import {Tool as MCPTool} from '@modelcontextprotocol/sdk/types.js';
import {EntryLineage, Token, Type} from '@frontmcp/sdk';
import {ToolRecordImpl} from '@frontmcp/core';
import {ToolChangeEvent} from './tool.events';
import {ToolInstance} from "./tool.instance";
import ToolRegistry from "./tool.registry";


export type Tool = MCPTool & {
  id: string;
  providedBy?: Token | string;
  preHook?: Token[];
  postHook?: Token[];
};

export type ToolResolveFn = <T>(cls: Type<T>) => T;

export type ToolProvidedByKind = 'adapter' | 'plugin' | 'inline';

/**
 * This tool registry is used to store all tools available in the gateway.
 * each tool is:
 * - identified by its name.
 * - can be used by the gateway to call it.
 * - identified by provided By (plugin, adapter, inline)
 * - identified by consent group to be filtered by authenticated session.
 * - detect multiple versions of the same tool.
 * - detect a single tool provided by multiple adapters / apps / plugins.
 *
 * registry can:
 * - register tools
 * - get tool by name
 * - list tools
 * - filter tools by consent group
 * - filter tools by provided by
 * - filter tools by name
 * - check if tools changed by specific filter
 * - expose function that will filter tools by (context) and return the filtered tools list.
 */
export interface ToolRegistryContract {
  // snapshots
  listGlobal(): readonly ToolRecordImpl[];

  // mutations
  upsertGlobal(record: ToolRecordImpl): ToolRecordImpl;

  // TODO: upsert based rule (user.id === 'david') =>
  upsertSession(sessionId: string, record: ToolRecordImpl): ToolRecordImpl;

  removeGlobal(by: { id?: string; name?: string }): boolean;

  removeSession(sessionId: string, by: { id?: string; name?: string }): boolean;

  // subscribe (scoped)
  subscribe(
    opts: { sessionId?: string; immediate?: boolean; filter?: (r: ToolRecordImpl) => boolean },
    cb: (evt: ToolChangeEvent) => void,
  ): () => void;
}



/** Internal augmented row: instance + provenance + token */
export type IndexedTool = {
  token: Token;
  instance: ToolInstance;
  /** base tool name from metadata (unmodified) */
  baseName: string;
  /** lineage & qualified info */
  lineage: EntryLineage;
  ownerKey: string;       // "app:Portal/plugin:Okta"
  qualifiedName: string;  // "app:Portal/plugin:Okta:toolName"
  qualifiedId: string;    // "app:Portal/plugin:Okta:tokenName(<token>)"
  /** which registry constructed the instance (the “owner” registry) */
  source: ToolRegistry;
};

/* -------------------- naming options & helpers (MCP constraints) -------------------- */

export type NameCase = 'snake' | 'camel' | 'kebab' | 'dot';
export type ExportNameOptions = {
  case?: NameCase;                        // default 'snake'
  maxLen?: number;                        // default 64
  prefixChildrenOnConflict?: boolean;     // default true
  prefixSource?: 'provider' | 'owner';    // default 'provider'
};

export const DEFAULT_EXPORT_OPTS: Required<ExportNameOptions> = {
  case: 'snake',
  maxLen: 64,
  prefixChildrenOnConflict: true,
  prefixSource: 'provider',
};