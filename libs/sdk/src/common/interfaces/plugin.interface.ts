import { Type, Token, ValueType, ClassType, FactoryType } from './base.interface';
import { PluginMetadata } from '../metadata';

export interface PluginInterface {}

export type PluginClassType<Provide> = ClassType<Provide> & PluginMetadata;
export type PluginValueType<Provide> = ValueType<Provide> & PluginMetadata;
export type PluginFactoryType<Provide, Tokens extends readonly Token[]> = FactoryType<Provide, Tokens> & PluginMetadata;

export type PluginType<Provide extends PluginInterface = PluginInterface> =
  | Type<Provide>
  | PluginClassType<Provide>
  | PluginValueType<Provide>
  | PluginFactoryType<Provide, readonly any[]>;
