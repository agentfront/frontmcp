import { type ClassType, type FactoryType, type Token, type Type, type ValueType } from '@frontmcp/di';

import { type PluginMetadata } from '../metadata';

export type PluginClassType<Provide> = ClassType<Provide> & PluginMetadata;
export type PluginValueType<Provide> = ValueType<Provide> & PluginMetadata;
export type PluginFactoryType<Provide, Tokens extends readonly Token[]> = FactoryType<Provide, Tokens> & PluginMetadata;

export type PluginType<Provide = unknown> =
  | Type<Provide>
  | PluginClassType<Provide>
  | PluginValueType<Provide>
  | PluginFactoryType<Provide, readonly any[]>;

/** A registered plugin: the object its class, value or factory produced, bound to the plugin's providers. */
export interface PluginInstance {
  get<T>(token: Token<T>): T;
}
