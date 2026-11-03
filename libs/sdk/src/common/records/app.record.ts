import { type Token, type Type } from '@frontmcp/di';

import { type AppEntry } from '../entries';
import { type LazyAppMetadata, type LocalAppMetadata, type OutputPolicy, type RemoteAppMetadata } from '../metadata';

export enum AppKind {
  LOCAL_CLASS = 'LOCAL_CLASS',
  REMOTE_VALUE = 'REMOTE_VALUE',
  LAZY_IMPORT = 'LAZY_IMPORT',
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

/**
 * A lazy app always joins the server's scope: it has no scope of its own and no `auth` of its own. Its `output` is
 * the loaded app's, read from the manifest until then.
 */
export type LazyAppRecordMetadata = LazyAppMetadata & { standalone: false; auth?: undefined; output?: OutputPolicy };

export type AppLazyImport = {
  kind: AppKind.LAZY_IMPORT;
  provide: Token<AppEntry>;
  metadata: LazyAppRecordMetadata;
};

export type AppRecord = AppClassToken | AppValue | AppLazyImport;
