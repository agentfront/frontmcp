import { type Type, type ValueType } from '@frontmcp/di';

import { type AppMetadata, type RemoteAppMetadata } from '../metadata';

export type AppValueType<Provide> = ValueType<Provide> & AppMetadata;

export type AppType<T = unknown> = Type<T> | AppValueType<T> | RemoteAppMetadata;
