/**
 * @file index.ts
 * @description Barrel exports for HTTP mock module
 */

export { httpMock, httpResponse } from './http-mock';

export type {
  HttpMethod,
  HttpRequestMatcher,
  HttpMockResponse,
  HttpMockDefinition,
  HttpRequestInfo,
  HttpMockHandle,
  HttpInterceptor,
  HttpMockManager,
  /** @deprecated Use HttpInterceptor instead */
  HttpInterceptor as HttpMockScope,
} from './http-mock.types';
