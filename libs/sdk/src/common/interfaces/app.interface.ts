import { Type, ValueType } from '@frontmcp/di';
import { AppMetadata } from '../metadata';

/** Marker interface for FrontMCP application classes */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AppInterface {}

export type AppValueType<Provide> = ValueType<Provide> & AppMetadata;

export type AppType<T extends AppInterface = any> = Type<T> | AppValueType<T>;
