import { ClassType, FactoryType, Type } from '../interfaces';
import { PluginMetadata } from '../metadata';

export enum PluginKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  CLASS = 'CLASS',
  FACTORY = 'FACTORY',
}

export interface PluginClassTokenRecord {
  kind: PluginKind.CLASS_TOKEN;
  provide: Type,
  metadata: PluginMetadata;
}

export interface PluginClassRecord extends ClassType<any> {
  kind: PluginKind.CLASS;
  metadata: PluginMetadata;
}

export interface PluginFactoryRecord extends FactoryType<any, any[]> {
  kind: PluginKind.FACTORY;
  metadata: PluginMetadata;
};

export type PluginRecord =
  | PluginClassTokenRecord
  | PluginClassRecord
  | PluginFactoryRecord


