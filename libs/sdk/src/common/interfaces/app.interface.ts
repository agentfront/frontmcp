import { Type, ValueType } from '@frontmcp/di';
import { AppMetadata } from '../metadata';

/** Marker interface for FrontMCP application classes */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AppInterface {}

export type AppValueType<Provide> = ValueType<Provide> & AppMetadata;

// Using 'any' default to allow broad compatibility with untyped app classes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppType<T extends AppInterface = any> = Type<T> | AppValueType<T>;
