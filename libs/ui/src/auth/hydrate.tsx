/**
 * Client mount entry for a FrontMCP auth page.
 *
 * The server serves a thin HTML shell with an EMPTY `#frontmcp-auth-root` mount
 * node, the injected {@link AuthFlowState} global, and a bundle that calls
 * {@link mountAuthPage} to render the developer's `@AuthUi` component into that
 * node in the BROWSER (pure client render — no server-side React, no
 * hydration). The component is wrapped in {@link AuthPageWrapper} so the
 * `useAuthFlow*` hooks have their context, and the injected state is read
 * automatically.
 *
 * @packageDocumentation
 */
import { type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AuthPageWrapper } from './AuthPageWrapper';
import { DEFAULT_AUTH_MOUNT_ID, type AuthFlowState } from './contract';

/** Re-export the framework-free mount id (single source of truth in `./contract`). */
export { DEFAULT_AUTH_MOUNT_ID } from './contract';

/**
 * Options for {@link mountAuthPage}.
 */
export interface MountAuthPageOptions {
  /**
   * The container to render into. Accepts an element or a selector; defaults to
   * `#frontmcp-auth-root` (the empty mount node the server shell ships).
   */
  container?: Element | string;
  /**
   * Override the flow state instead of reading the injected global (tests /
   * preview). Production omits this.
   */
  state?: AuthFlowState;
  /**
   * Whether the wrapper renders its enclosing `<form>`. Mirrors
   * {@link AuthPageWrapper}'s `renderForm` (default true).
   */
  renderForm?: boolean;
}

/** Resolve the container option into a concrete DOM element. */
function resolveContainer(container?: Element | string): Element {
  if (container && typeof container !== 'string') {
    return container;
  }
  if (typeof document === 'undefined') {
    throw new Error('[auth-ui] mountAuthPage requires a DOM (document is undefined)');
  }
  const selector = container ?? `#${DEFAULT_AUTH_MOUNT_ID}`;
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`[auth-ui] mountAuthPage could not find a container matching "${selector}"`);
  }
  return el;
}

/**
 * Render `Component` (a developer `@AuthUi` page) into the (empty) mount node in
 * the browser, wrapping it in {@link AuthPageWrapper}. This is a PURE client
 * render via `createRoot(...).render(...)` — the server ships no component
 * markup, so there is nothing to hydrate.
 *
 * @param Component The page component to render.
 * @param options   Container / state / form overrides.
 * @returns The React {@link Root} (so callers can `unmount()` in tests).
 */
export function mountAuthPage(Component: ComponentType, options: MountAuthPageOptions = {}): Root {
  const container = resolveContainer(options.container);
  const root = createRoot(container);
  root.render(
    <AuthPageWrapper state={options.state} renderForm={options.renderForm}>
      <Component />
    </AuthPageWrapper>,
  );
  return root;
}
