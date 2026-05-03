import { type Token, type Type } from '@frontmcp/di';

import { type AppEntry } from '../entries';
import { type LocalAppMetadata, type RemoteAppMetadata } from '../metadata';

export enum AppKind {
  LOCAL_CLASS = 'LOCAL_CLASS',
  REMOTE_VALUE = 'REMOTE_VALUE',
}

export type AppClassToken = {
  kind: AppKind.LOCAL_CLASS;
  provide: Type<AppEntry>;
  metadata: LocalAppMetadata;
};

export type AppValue = {
  kind: AppKind.REMOTE_VALUE;
  provide: Token<AppEntry>;
  useValue: AppEntry;
  metadata: RemoteAppMetadata;
};

export type AppRecord = AppClassToken | AppValue;
