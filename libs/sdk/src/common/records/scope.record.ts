import { Token, Type } from '@frontmcp/di';
import { AppScopeMetadata, MultiAppScopeMetadata } from '../metadata';
import { ScopeEntry } from '../entries';

export enum ScopeKind {
  SPLIT_BY_APP = 'SPLIT_BY_APP',
  MULTI_APP = 'MULTI_APP',
}

export type SplitByAppScope = {
  kind: ScopeKind.SPLIT_BY_APP;
  provide: Token;
  metadata: AppScopeMetadata;
};

export type MultiAppScope = {
  kind: ScopeKind.MULTI_APP;
  provide: Type<ScopeEntry>;
  metadata: MultiAppScopeMetadata;
};

export type ScopeRecord = SplitByAppScope | MultiAppScope;
