import { Type, ValueType } from '@frontmcp/di';
import { AppMetadata, RemoteAppMetadata } from '../metadata';

export type AppValueType<Provide> = ValueType<Provide> & AppMetadata;

export type AppType<T = unknown> = Type<T> | AppValueType<T> | RemoteAppMetadata;
