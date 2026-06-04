/**
 * `@frontmcp/ui/auth` — client-side primitives for FrontMCP custom
 * authorization UIs (issue #469): the framework-free contract (no React) plus
 * React hooks + chrome built on the framework-free vanilla core.
 *
 * This subpath is the SINGLE SOURCE OF TRUTH for the client-side auth contract
 * (`AuthFlowState`, `AuthSlot`, the wire constants, …). It imports ONLY `react`
 * / `react-dom` (peer) — NEVER `@mui/material` / `@emotion` — so the auth page
 * loads a lean module from esm.sh.
 *
 * Entry points:
 * - `@frontmcp/ui/auth`          — contract + vanilla helpers + React hooks/wrapper/mount.
 * - `@frontmcp/ui/auth/vanilla`  — framework-free flow helpers (`getAuthFlow`, `submitFinish`, `submitExtra`, `getAddedItems`).
 *
 * @packageDocumentation
 */

// Framework-free contract (no React) — single source of truth, co-located here.
export * from './contract';

// Framework-free (browser-DOM) flow helpers.
export {
  getAddedItems,
  getAuthFlow,
  setAuthNavigator,
  submitExtra,
  submitFinish,
  tryGetAuthFlow,
  type AuthNavigator,
  type SubmitFinishOptions,
} from './vanilla/auth-flow';

// React context + hooks + chrome + hydration.
export { AuthFlowContext, type AuthFlowContextValue } from './context';
export { AuthFlowProvider, AuthPageWrapper, type AuthPageWrapperProps } from './AuthPageWrapper';
export { useAddedItems, useAuthFlow, useExtraField, type UseAuthFlowResult, type UseExtraFieldResult } from './hooks';
export { DEFAULT_AUTH_MOUNT_ID, mountAuthPage, type MountAuthPageOptions } from './hydrate';
