import { ClassType, FrontMcpAuth, Token, Type, ValueType } from '../interfaces';
import { AuthProviderMetadata } from '../metadata';
import { AuthOptions } from '../types';

export enum AuthProviderKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  CLASS = 'CLASS',
  VALUE = 'VALUE',
  FACTORY = 'FACTORY',
  PRIMARY = 'PRIMARY',
}

export interface AuthProviderClassTokenRecord {
  kind: AuthProviderKind.CLASS_TOKEN;
  provide: Type,
  metadata: AuthProviderMetadata;
}

export interface AuthProviderClassRecord extends ClassType<any> {
  kind: AuthProviderKind.CLASS;
  metadata: AuthProviderMetadata;
}

export interface AuthProviderValueRecord extends ValueType<any> {
  kind: AuthProviderKind.VALUE;
  metadata: AuthProviderMetadata;
}

export interface AuthProviderFactoryRecord {
  kind: AuthProviderKind.FACTORY;
  provide: Token;
  inject: () => readonly Token[];
  useFactory: (...args: any[]) => any | Promise<any>;
  metadata: AuthProviderMetadata;
}

export type PrimaryAuthRecord = {
  kind: AuthProviderKind.PRIMARY;
  provide: Token<FrontMcpAuth>;
  useValue: FrontMcpAuth;
  metadata: AuthOptions;
};


export type AuthProviderRecord =
  | AuthProviderClassTokenRecord
  | AuthProviderClassRecord
  | AuthProviderValueRecord
  | AuthProviderFactoryRecord
  | PrimaryAuthRecord


