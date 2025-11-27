/**
 * @file interceptor-chain.ts
 * @description Interceptor chain for request/response interception
 */

import type { JsonRpcRequest, JsonRpcResponse } from '../transport/transport.interface';
import type {
  InterceptorChain,
  RequestInterceptor,
  ResponseInterceptor,
  InterceptorContext,
  InterceptorResult,
  ResponseInterceptorContext,
  ResponseInterceptorResult,
  MockRegistry,
} from './interceptor.types';
import { DefaultMockRegistry } from './mock-registry';

/**
 * Default implementation of InterceptorChain
 */
export class DefaultInterceptorChain implements InterceptorChain {
  request: RequestInterceptor[] = [];
  response: ResponseInterceptor[] = [];
  mocks: MockRegistry;

  constructor() {
    this.mocks = new DefaultMockRegistry();
  }

  /**
   * Add a request interceptor
   */
  addRequestInterceptor(interceptor: RequestInterceptor): () => void {
    this.request.push(interceptor);
    return () => {
      const index = this.request.indexOf(interceptor);
      if (index !== -1) {
        this.request.splice(index, 1);
      }
    };
  }

  /**
   * Add a response interceptor
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
    this.response.push(interceptor);
    return () => {
      const index = this.response.indexOf(interceptor);
      if (index !== -1) {
        this.response.splice(index, 1);
      }
    };
  }

  /**
   * Process a request through the interceptor chain
   * Returns either:
   * - { type: 'continue', request } - continue with (possibly modified) request
   * - { type: 'mock', response } - return mock response immediately
   * - { type: 'error', error } - throw error
   */
  async processRequest(
    request: JsonRpcRequest,
    meta: InterceptorContext['meta'],
  ): Promise<
    | { type: 'continue'; request: JsonRpcRequest }
    | { type: 'mock'; response: JsonRpcResponse }
    | { type: 'error'; error: Error }
  > {
    let currentRequest = request;

    // 1. Check mocks first
    const mockDef = this.mocks.match(request);
    if (mockDef) {
      // Apply delay if specified
      if (mockDef.delay && mockDef.delay > 0) {
        await sleep(mockDef.delay);
      }

      // Get mock response
      let mockResponse: JsonRpcResponse;
      if (typeof mockDef.response === 'function') {
        mockResponse = await mockDef.response(request);
      } else {
        mockResponse = mockDef.response;
      }

      // Ensure the response ID matches the request ID
      return {
        type: 'mock',
        response: { ...mockResponse, id: request.id ?? mockResponse.id },
      };
    }

    // 2. Run request interceptors
    for (const interceptor of this.request) {
      const ctx: InterceptorContext = {
        request: currentRequest,
        meta,
      };

      const result = await interceptor(ctx);

      switch (result.action) {
        case 'passthrough':
          // Continue with current request
          break;
        case 'modify':
          // Use modified request
          currentRequest = result.request;
          break;
        case 'mock':
          // Return mock response immediately
          return {
            type: 'mock',
            response: { ...result.response, id: request.id ?? result.response.id },
          };
        case 'error':
          return { type: 'error', error: result.error };
      }
    }

    return { type: 'continue', request: currentRequest };
  }

  /**
   * Process a response through the interceptor chain
   */
  async processResponse(
    request: JsonRpcRequest,
    response: JsonRpcResponse,
    durationMs: number,
  ): Promise<JsonRpcResponse> {
    let currentResponse = response;

    for (const interceptor of this.response) {
      const ctx: ResponseInterceptorContext = {
        request,
        response: currentResponse,
        durationMs,
      };

      const result = await interceptor(ctx);

      switch (result.action) {
        case 'passthrough':
          // Continue with current response
          break;
        case 'modify':
          // Use modified response
          currentResponse = result.response;
          break;
      }
    }

    return currentResponse;
  }

  /**
   * Clear all interceptors and mocks
   */
  clear(): void {
    this.request = [];
    this.response = [];
    this.mocks.clear();
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convenience interceptor creators
 */
export const interceptors = {
  /**
   * Create an interceptor that logs all requests
   */
  logger(logFn: (message: string, data?: unknown) => void = console.log): RequestInterceptor {
    return (ctx) => {
      logFn(`[MCP Request] ${ctx.request.method}`, ctx.request.params);
      return { action: 'passthrough' };
    };
  },

  /**
   * Create an interceptor that adds latency to all requests
   */
  delay(ms: number): RequestInterceptor {
    return async () => {
      await sleep(ms);
      return { action: 'passthrough' };
    };
  },

  /**
   * Create an interceptor that fails requests matching a condition
   */
  failWhen(condition: (ctx: InterceptorContext) => boolean, error: Error | string): RequestInterceptor {
    return (ctx) => {
      if (condition(ctx)) {
        const err = typeof error === 'string' ? new Error(error) : error;
        return { action: 'error', error: err };
      }
      return { action: 'passthrough' };
    };
  },

  /**
   * Create an interceptor that modifies specific methods
   */
  modifyMethod(method: string, modifier: (request: JsonRpcRequest) => JsonRpcRequest): RequestInterceptor {
    return (ctx) => {
      if (ctx.request.method === method) {
        return { action: 'modify', request: modifier(ctx.request) };
      }
      return { action: 'passthrough' };
    };
  },

  /**
   * Create a response interceptor that logs responses
   */
  responseLogger(logFn: (message: string, data?: unknown) => void = console.log): ResponseInterceptor {
    return (ctx) => {
      const status = ctx.response.error ? 'ERROR' : 'OK';
      logFn(`[MCP Response] ${ctx.request.method} ${status} (${ctx.durationMs}ms)`, ctx.response);
      return { action: 'passthrough' };
    };
  },

  /**
   * Create a response interceptor that modifies specific responses
   */
  modifyResponse(method: string, modifier: (response: JsonRpcResponse) => JsonRpcResponse): ResponseInterceptor {
    return (ctx) => {
      if (ctx.request.method === method) {
        return { action: 'modify', response: modifier(ctx.response) };
      }
      return { action: 'passthrough' };
    };
  },
};
