import { ClassType, FactoryType, Type, ValueType } from '@frontmcp/di';
import { ProviderType } from '../interfaces';
import { PluginMetadata } from '../metadata';

export enum PluginKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  CLASS = 'CLASS',
  FACTORY = 'FACTORY',
  VALUE = 'VALUE',
}

export interface PluginClassTokenRecord {
  kind: PluginKind.CLASS_TOKEN;
  provide: Type;
  metadata: PluginMetadata;
  providers?: ProviderType[];
}

export interface PluginClassRecord extends ClassType<any> {
  kind: PluginKind.CLASS;
  metadata: PluginMetadata;
  providers?: ProviderType[];
}

export interface PluginFactoryRecord extends FactoryType<any, any[]> {
  kind: PluginKind.FACTORY;
  metadata: PluginMetadata;
  providers?: ProviderType[];
}

export interface PluginValueRecord extends ValueType<any> {
  kind: PluginKind.VALUE;
  metadata: PluginMetadata;
  providers?: ProviderType[];
}

export type PluginRecord = PluginClassTokenRecord | PluginClassRecord | PluginFactoryRecord | PluginValueRecord;
