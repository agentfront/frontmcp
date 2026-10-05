import { type ClassType, type FactoryType, type Token, type Type, type ValueType } from '@frontmcp/di';

import { type PluginMetadata } from '../metadata';

export type PluginClassType<Provide> = ClassType<Provide> & PluginMetadata;
export type PluginValueType<Provide> = ValueType<Provide> & PluginMetadata;
/** A factory plugin; without `inject`, the factory receives no dependencies. */
export type PluginFactoryType<Provide, Tokens extends readonly Token[]> = Omit<FactoryType<Provide, Tokens>, 'inject'> &
  Partial<Pick<FactoryType<Provide, Tokens>, 'inject'>> &
  PluginMetadata;

export type PluginType<Provide = unknown> =
  | Type<Provide>
  | PluginClassType<Provide>
  | PluginValueType<Provide>
  | PluginFactoryType<Provide, readonly any[]>;

/** A registered plugin: the object its class, value or factory produced, bound to the plugin's providers. */
export interface PluginInstance {
  get<T>(token: Token<T>): T;
}
