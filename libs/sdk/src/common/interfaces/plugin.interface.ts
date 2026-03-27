import { Type, Token, ValueType, ClassType, FactoryType } from '@frontmcp/di';
import { PluginMetadata } from '../metadata';

export type PluginClassType<Provide> = ClassType<Provide> & PluginMetadata;
export type PluginValueType<Provide> = ValueType<Provide> & PluginMetadata;
export type PluginFactoryType<Provide, Tokens extends readonly Token[]> = FactoryType<Provide, Tokens> & PluginMetadata;

export type PluginType<Provide = unknown> =
  | Type<Provide>
  | PluginClassType<Provide>
  | PluginValueType<Provide>
  | PluginFactoryType<Provide, readonly any[]>;
