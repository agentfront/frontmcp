/**
 * @file register.ts
 * @description Registration utilities for FrontMCP Web Components.
 *
 * Provides functions to register custom elements either all at once
 * or individually for tree-shaking optimization.
 *
 * @example Register all components
 * ```typescript
 * import { registerAllComponents } from '@frontmcp/ui/web-components';
 *
 * // Register all FrontMCP components
 * registerAllComponents();
 *
 * // Then use in HTML:
 * // <fmcp-button variant="primary">Click</fmcp-button>
 * ```
 *
 * @example Register individual components (tree-shakeable)
 * ```typescript
 * import { registerFmcpButton, registerFmcpCard } from '@frontmcp/ui/web-components';
 *
 * // Only register what you need
 * registerFmcpButton();
 * registerFmcpCard();
 * ```
 *
 * @module @frontmcp/ui/web-components/register
 */

import { registerFmcpButton } from './elements/fmcp-button';
import { registerFmcpCard } from './elements/fmcp-card';
import { registerFmcpAlert } from './elements/fmcp-alert';
import { registerFmcpBadge } from './elements/fmcp-badge';
import { registerFmcpInput } from './elements/fmcp-input';
import { registerFmcpSelect } from './elements/fmcp-select';

/**
 * Register all FrontMCP Web Components.
 *
 * This function registers all available custom elements:
 * - `<fmcp-button>` - Button component
 * - `<fmcp-card>` - Card component
 * - `<fmcp-alert>` - Alert/notification component
 * - `<fmcp-badge>` - Badge component
 * - `<fmcp-input>` - Form input component
 * - `<fmcp-select>` - Form select component
 *
 * @example
 * ```typescript
 * import { registerAllComponents } from '@frontmcp/ui/web-components';
 *
 * // Call once on app startup
 * registerAllComponents();
 * ```
 */
export function registerAllComponents(): void {
  registerFmcpButton();
  registerFmcpCard();
  registerFmcpAlert();
  registerFmcpBadge();
  registerFmcpInput();
  registerFmcpSelect();
}

// Re-export individual registration functions
export {
  registerFmcpButton,
  registerFmcpCard,
  registerFmcpAlert,
  registerFmcpBadge,
  registerFmcpInput,
  registerFmcpSelect,
};

// Auto-register if script tag has data-auto-register attribute
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const script = document.currentScript;
  if (script?.hasAttribute('data-auto-register')) {
    registerAllComponents();
  }
}
