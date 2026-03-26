import { Type, ValueType } from '@frontmcp/di';
import { AppMetadata, RemoteAppMetadata } from '../metadata';

export type AppValueType<Provide> = ValueType<Provide> & AppMetadata;

// Using 'any' default to allow broad compatibility with untyped app classes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppType<T = any> = Type<T> | AppValueType<T> | RemoteAppMetadata;
