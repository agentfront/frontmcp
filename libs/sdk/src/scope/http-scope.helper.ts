/** What a scope that serves HTTP builds, loaded only by such a scope (not by a direct-only one). */
export { default as HttpRequestFlow } from './flows/http.request.flow';
export { default as HttpIpFilterFlow } from './flows/http.ip-filter.flow';
export { TransportService } from '../transport/transport.registry';
export { registerCustomHttpRoutes } from '../server/custom-routes.helper';
export { HealthService, servedHealthPaths } from '../health';
