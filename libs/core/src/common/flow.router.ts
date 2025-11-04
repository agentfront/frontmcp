import { ServerRequest } from '@frontmcp/sdk';
import { Router } from 'itty-router';

export const authorizedFlowRouter = Router<ServerRequest, never, keyof PublicRouteFlows | undefined>();
export const publicFlowRouter = Router<ServerRequest, never, keyof PublicRouteFlows | undefined>();
