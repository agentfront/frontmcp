import { ClassType, Token, Type, ValueType } from '../interfaces';
import { ProviderMetadata } from '../metadata';

export enum ProviderKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  CLASS = 'CLASS',
  VALUE = 'VALUE',
  FACTORY = 'FACTORY',
  INJECTED = 'INJECTED',
}

export interface ProviderClassTokenRecord {
  kind: ProviderKind.CLASS_TOKEN;
  provide: Type,
  metadata: ProviderMetadata;
}

export interface ProviderClassRecord extends ClassType<any> {
  kind: ProviderKind.CLASS;
  metadata: ProviderMetadata;
}

export interface ProviderValueRecord extends ValueType<any> {
  kind: ProviderKind.VALUE;
  metadata: ProviderMetadata;
}

export interface ProviderFactoryRecord {
  kind: ProviderKind.FACTORY;
  provide: Token;
  inject: () => readonly Token[];
  useFactory: (...args: any[]) => any | Promise<any>;
  metadata: ProviderMetadata;
};

export interface ProviderInjectedRecord {
  kind: ProviderKind.INJECTED;
  provide: Token;
  value: any;
  metadata: ProviderMetadata;
};

export type ProviderRecord =
  | ProviderClassTokenRecord
  | ProviderClassRecord
  | ProviderValueRecord
  | ProviderFactoryRecord
  | ProviderInjectedRecord;


