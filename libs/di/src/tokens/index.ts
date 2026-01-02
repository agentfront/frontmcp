/**
 * Token system for dependency injection.
 *
 * This module provides:
 * - Token factory for creating type-safe DI tokens
 * - DI-related metadata constants
 */

export { createTokenFactory, DiTokens, type TokenFactory, type TokenFactoryOptions } from './token.factory.js';

export { DESIGN_PARAMTYPES, META_ASYNC_WITH, META_ASYNC_WITH_TOKENS } from './di.constants.js';
