/**
 * `@frontmcp/ui/auth/vanilla` — framework-free (browser-DOM) flow helpers + the
 * contract.
 *
 * Re-exports the contract (the single source of truth lives in
 * `@frontmcp/ui/auth`) so a non-React page can
 * `import { getAuthFlow, type AuthFlowState } from '@frontmcp/ui/auth/vanilla'`
 * from a single entrypoint.
 *
 * @packageDocumentation
 */
export * from '../contract';
export * from './auth-flow';
