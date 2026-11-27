import 'reflect-metadata';

import type { AuthoritiesMetadata } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';
import { type HttpRouteType } from '../interfaces/http-route.interface';
import {
  defineHttpRouteMetadata,
  HTTP_ROUTE_PATH_MESSAGE,
  isHttpRoutePath,
  type HttpRouteMetadata,
  type HttpRouteTopicSource,
} from '../metadata/http-route.metadata';

const httpRouteMetadataSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], {
      message: "method must be 'GET', 'POST', 'PUT', 'PATCH' or 'DELETE'",
    }),
    path: z.custom<string | (() => string)>((value) => typeof value === 'function' || isHttpRoutePath(value), {
      message: HTTP_ROUTE_PATH_MESSAGE,
    }),
    auth: z
      .enum(['people', 'subject', 'bearer', 'public'], {
        message: "auth must be 'people', 'subject', 'bearer' or 'public'",
      })
      .optional(),
    authorities: z
      .custom<AuthoritiesMetadata>((rule) => typeof rule === 'string' || (typeof rule === 'object' && rule !== null), {
        message: 'authorities must be a profile name, a list of names or a policy',
      })
      .optional(),
    sse: z
      .object({
        store: z.custom<HttpRouteTopicSource>(
          (value) => typeof (value as Partial<HttpRouteTopicSource> | null)?.subscribe === 'function',
          { message: 'sse.store must have subscribe(topic, listener), such as a resourceStore()' },
        ),
        topics: z
          .array(z.string().min(1, 'a topic must not be empty'))
          .min(1, 'sse.topics must name at least one topic'),
        coalesceMs: z.number().int().nonnegative('sse.coalesceMs must not be negative').default(50),
        heartbeatMs: z.number().int().positive('sse.heartbeatMs must be greater than 0').default(15_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((metadata) => !metadata.sse || metadata.method === 'GET', {
    message: 'an sse route must use method GET',
    path: ['sse'],
  })
  .refine((metadata) => metadata.authorities === undefined || metadata.auth === 'bearer', {
    message: "authorities need auth: 'bearer', whose token names the caller they check",
    path: ['authorities'],
  });

/**
 * Marks a class as an HTTP route of its app, served beside the MCP endpoint through the hookable `http:route` flow:
 * the IP filter, a same-origin check on mutations, people or bearer auth, the route's `authorities`, then `handle()`.
 * List it in `@App({ routes })`.
 */
export function HttpRoute(metadata: HttpRouteMetadata): (target: HttpRouteType) => void {
  return (target) => {
    const result = httpRouteMetadataSchema.safeParse(metadata);
    if (!result.success) {
      const [issue] = result.error.issues;
      throw new InvalidDecoratorMetadataError('HttpRoute', issue.path.join('.') || 'metadata', issue.message);
    }
    if (typeof target.prototype?.handle !== 'function') {
      throw new InvalidDecoratorMetadataError('HttpRoute', 'handle', `${target.name} has no handle() method`);
    }
    defineHttpRouteMetadata(target, result.data);
  };
}
