import {ClassType, FactoryType, Type, ValueType} from '../interfaces';
import {PluginMetadata} from '../metadata';
import {ProviderRecord} from "./provider.record";

export enum PluginKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  CLASS = 'CLASS',
  FACTORY = 'FACTORY',
  VALUE = 'VALUE',
}

export interface PluginClassTokenRecord {
  kind: PluginKind.CLASS_TOKEN;
  provide: Type,
  metadata: PluginMetadata;
  providers?: ProviderRecord[];
}

export interface PluginClassRecord extends ClassType<any> {
  kind: PluginKind.CLASS;
  metadata: PluginMetadata;
  providers?: ProviderRecord[];
}

export interface PluginFactoryRecord extends FactoryType<any, any[]> {
  kind: PluginKind.FACTORY;
  metadata: PluginMetadata;
  providers?: ProviderRecord[];
}

export interface PluginValueRecord extends ValueType<any> {
  kind: PluginKind.VALUE;
  metadata: PluginMetadata;
  providers?: ProviderRecord[];
}

export type PluginRecord =
  | PluginClassTokenRecord
  | PluginClassRecord
  | PluginFactoryRecord
  | PluginValueRecord


