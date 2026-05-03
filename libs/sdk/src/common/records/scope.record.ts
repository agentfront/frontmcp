import { type Token, type Type } from '@frontmcp/di';

import { type ScopeEntry } from '../entries';
import { type AppScopeMetadata, type MultiAppScopeMetadata } from '../metadata';

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
