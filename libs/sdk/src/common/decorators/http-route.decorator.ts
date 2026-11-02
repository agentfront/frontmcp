import 'reflect-metadata';

import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';
import { type HttpRouteType } from '../interfaces/http-route.interface';
import {
  defineHttpRouteMetadata,
  httpRouteMetadataSchema,
  type HttpRouteMetadata,
} from '../metadata/http-route.metadata';

/**
 * Marks a class as an HTTP route of its app, served beside the MCP endpoint through the hookable `http:route` flow:
 * the IP filter, a same-origin check on mutations, people auth, then `handle()`. List it in `@App({ routes })`.
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
