/**
 * DI-related metadata keys and constants.
 *
 * These symbols are used with reflect-metadata for storing and retrieving
 * dependency injection metadata on classes.
 */

/**
 * Metadata key for design:paramtypes (TypeScript's emitted constructor parameter types).
 * Used by reflect-metadata to store constructor parameter type information.
 */
export const DESIGN_PARAMTYPES = 'design:paramtypes';

/**
 * Metadata key indicating a class uses async initialization via static `with()` method.
 * When this metadata is present, the DI container will call the static `with()` method
 * instead of the constructor for instantiation.
 */
export const META_ASYNC_WITH = Symbol('di:async-with');

/**
 * Metadata key for storing the token array used by @AsyncWith decorator.
 * Contains a function that returns the dependency tokens for the static `with()` method.
 */
export const META_ASYNC_WITH_TOKENS = Symbol('di:async-with-tokens');
