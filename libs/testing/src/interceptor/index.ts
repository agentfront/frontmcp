/**
 * @file index.ts
 * @description Barrel exports for interceptor module
 */

// Types
export type {
  InterceptorContext,
  InterceptorResult,
  RequestInterceptor,
  ResponseInterceptorContext,
  ResponseInterceptorResult,
  ResponseInterceptor,
  MockDefinition,
  MockRegistry,
  MockHandle,
  InterceptorChain,
} from './interceptor.types';

// Classes
export { DefaultMockRegistry, mockResponse } from './mock-registry';
export { DefaultInterceptorChain, interceptors } from './interceptor-chain';
