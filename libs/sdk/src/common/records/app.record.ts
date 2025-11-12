import { Token, Type } from '../interfaces';
import { LocalAppMetadata, RemoteAppMetadata } from '../metadata';
import { AppEntry } from '../entries';

export enum AppKind {
  LOCAL_CLASS = 'LOCAL_CLASS',
  REMOTE_VALUE = 'REMOTE_VALUE',
}

export type AppClassToken = {
  kind: AppKind.LOCAL_CLASS;
  provide: Type<AppEntry>;
  metadata: LocalAppMetadata
};

export type AppValue = {
  kind: AppKind.REMOTE_VALUE;
  provide: Token<AppEntry>;
  useValue: AppEntry;
  metadata: RemoteAppMetadata
};

export type AppRecord =
  | AppClassToken
  | AppValue
