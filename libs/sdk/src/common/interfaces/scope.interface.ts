import { Type } from '@frontmcp/di';

export interface ScopeInterface {}

export type ScopeType = Type<ScopeInterface>;

export { ScopeInterface as FrontMcpScopeInterface, ScopeType as FrontMcpScopeType };
