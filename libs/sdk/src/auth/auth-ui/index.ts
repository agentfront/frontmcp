/**
 * Custom authorization-UI wiring (#469 — slot→file map + name→handler map).
 *
 * For each OAuth flow slot the server TRANSFORMS the developer's registered
 * `.tsx` ONCE (esbuild `transformSync`, single file — deps stay external) via
 * `@frontmcp/uipack`'s pluggable `renderComponent`, inlines it as a `<script
 * type="module">`, and loads react / react-dom / `@frontmcp/ui/auth` from esm.sh
 * via an import-map. `@frontmcp/ui/auth`'s `mountAuthPage` renders the component
 * client-side into the empty `#frontmcp-auth-root` mount, honoring the
 * framework-free `@frontmcp/ui/auth` contract (the server holds a matching,
 * server-owned write-shape in `auth-ui.contract.ts`). There is NO bundling and
 * the server never imports or evaluates the component, nor `@frontmcp/ui`.
 *
 * Registration is the `auth.ui` / `auth.extras` maps on the auth config — there
 * is no decorator and no class. See `@frontmcp/auth`'s `AuthUiMap` /
 * `AuthExtraHandler`.
 *
 * @packageDocumentation
 */

// Server-owned write-shape contract (matches the @frontmcp/ui/auth read-shape).
export {
  AUTH_FLOW_GLOBAL_KEY,
  type AuthFlowState,
  type AuthSlot,
  type AuthProvider,
  type AuthTool,
  type AuthExtraResult,
  type AuthUiFileSource,
} from './auth-ui.contract';

// Registry
export { AuthUiRegistry, type AuthExtraRunResult } from './auth-ui.registry';

// Page assembly + state builders
export {
  AUTH_MOUNT_ID,
  AUTH_UI_CSP,
  authUiExtraPath,
  authUiPageHeaders,
  authUiSecurityHeaders,
  buildAuthUiPage,
} from './auth-ui.render';
export {
  buildLoginState,
  buildConsentState,
  buildFederatedState,
  buildIncrementalState,
  buildErrorState,
} from './auth-ui.state';
