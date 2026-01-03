/**
 * Provider record types for the DI container.
 *
 * These types represent normalized provider definitions stored in the registry.
 */

import type { Type, Token, ClassType, ValueType } from '../interfaces/base.interface.js';
import type { ProviderMetadata } from '../metadata/provider.metadata.js';

/**
 * Provider kinds supported by the DI container.
 */
export enum ProviderKind {
  /** Class used directly as token (new Class()) */
  CLASS_TOKEN = 'CLASS_TOKEN',
  /** useClass pattern: provide token, use different class */
  CLASS = 'CLASS',
  /** useValue pattern: provide static value */
  VALUE = 'VALUE',
  /** useFactory pattern: provide factory function */
  FACTORY = 'FACTORY',
  /** Pre-instantiated value injected directly */
  INJECTED = 'INJECTED',
}

/**
 * Record for CLASS_TOKEN provider kind.
 * The class itself is used as both the token and implementation.
 */
export interface ProviderClassTokenRecord {
  kind: ProviderKind.CLASS_TOKEN;
  provide: Type;
  metadata: ProviderMetadata;
}

/**
 * Record for CLASS provider kind.
 * Uses one token to provide a different class implementation.
 */
export interface ProviderClassRecord extends ClassType<any> {
  kind: ProviderKind.CLASS;
  metadata: ProviderMetadata;
}

/**
 * Record for VALUE provider kind.
 * Provides a static value as a dependency.
 */
export interface ProviderValueRecord extends ValueType<any> {
  kind: ProviderKind.VALUE;
  metadata: ProviderMetadata;
}

/**
 * Record for FACTORY provider kind.
 * Uses a factory function to create the dependency.
 */
export interface ProviderFactoryRecord {
  kind: ProviderKind.FACTORY;
  provide: Token;
  inject: () => readonly Token[];
  useFactory: (...args: any[]) => any | Promise<any>;
  metadata: ProviderMetadata;
}

/**
 * Record for INJECTED provider kind.
 * A pre-instantiated value injected directly into the container.
 */
export interface ProviderInjectedRecord {
  kind: ProviderKind.INJECTED;
  provide: Token;
  value: any;
  metadata: ProviderMetadata;
}

/**
 * Union of all provider record types.
 * This is the normalized internal representation stored in the registry.
 */
export type ProviderRecord =
  | ProviderClassTokenRecord
  | ProviderClassRecord
  | ProviderValueRecord
  | ProviderFactoryRecord
  | ProviderInjectedRecord;
