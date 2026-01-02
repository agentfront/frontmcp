/**
 * Core interfaces for dependency injection.
 */

// Base types
export {
  type Type,
  type FuncType,
  type PartialStagesType,
  type CtorType,
  type Ctor,
  type Abstract,
  type Reference,
  type Token,
  type ClassType,
  type ValueType,
  type ClassToken,
  type FactoryType,
  type RequiredByKey,
} from './base.interface.js';

// Provider interfaces
export {
  type ProviderInterface,
  type ProviderClassTokenType,
  type ProviderClassType,
  type ProviderValueType,
  type ProviderFactoryType,
  type ProviderType,
  type AsyncProvider,
} from './provider.interface.js';

// Registry interfaces
export { type DiContainerInterface, type DiViews } from './registry.interface.js';
