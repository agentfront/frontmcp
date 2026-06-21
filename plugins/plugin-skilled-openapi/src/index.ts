// file: plugins/plugin-skilled-openapi/src/index.ts

import SkilledOpenApiPlugin from './skilled-openapi.plugin';

export { SkilledOpenApiPlugin };
export default SkilledOpenApiPlugin;

// Cross-package runtime-deps injection (used by `@frontmcp/edge` to supply a
// KV cache + disable polling on a Worker and receive the live source for
// Cron-driven refresh). Hosts may also just provide a value under the matching
// `Symbol.for(...)` without importing this plugin.
export {
  SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN,
  type SkilledOpenApiRuntimeDeps,
} from './skilled-openapi.plugin';

export { skilledOpenApiPluginOptionsSchema } from './skilled-openapi.types';
export type {
  SkilledOpenApiPluginOptions,
  SkilledOpenApiPluginOptionsInput,
  BundleSourceOptions,
  StaticSourceOptions,
  NpmSourceOptions,
  SaasSourceOptions,
  SignatureKey,
  OutboundOptions,
} from './skilled-openapi.types';
export { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from './skilled-openapi.symbols';
