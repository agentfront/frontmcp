import { ClassType, FactoryType, Type, ValueType } from '@frontmcp/di';
import { AdapterMetadata } from '../metadata';

export enum AdapterKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  CLASS = 'CLASS',
  VALUE = 'VALUE',
  FACTORY = 'FACTORY',
}

export interface AdapterClassTokenRecord {
  kind: AdapterKind.CLASS_TOKEN;
  provide: Type;
  metadata: AdapterMetadata;
}

export interface AdapterClassRecord extends ClassType<any> {
  kind: AdapterKind.CLASS;
  metadata: AdapterMetadata;
}

export interface AdapterValueRecord extends ValueType<any> {
  kind: AdapterKind.VALUE;
  metadata: AdapterMetadata;
}

export interface AdapterFactoryRecord extends FactoryType<any, any> {
  kind: AdapterKind.FACTORY;
  metadata: AdapterMetadata;
}

export type AdapterRecord = AdapterClassTokenRecord | AdapterClassRecord | AdapterValueRecord | AdapterFactoryRecord;
