/**
 * @file index.ts
 * @description FrontMCP Web Components - Custom Elements for React/Vue/HTML.
 *
 * This module provides Web Components (Custom Elements) that wrap the
 * FrontMCP UI HTML functions, allowing native usage in any framework.
 *
 * @example Basic usage
 * ```typescript
 * import { registerAllComponents } from '@frontmcp/ui/web-components';
 *
 * // Register all components
 * registerAllComponents();
 *
 * // Use in HTML
 * // <fmcp-button variant="primary">Click Me</fmcp-button>
 * ```
 *
 * @example React usage
 * ```tsx
 * import { registerFmcpButton } from '@frontmcp/ui/web-components';
 *
 * registerFmcpButton();
 *
 * function App() {
 *   return (
 *     <fmcp-button variant="primary" onClick={handleClick}>
 *       Click Me
 *     </fmcp-button>
 *   );
 * }
 * ```
 *
 * @example Tree-shakeable imports
 * ```typescript
 * import { registerFmcpButton, registerFmcpCard } from '@frontmcp/ui/web-components';
 *
 * // Only register the components you need
 * registerFmcpButton();
 * registerFmcpCard();
 * ```
 *
 * @module @frontmcp/ui/web-components
 */

// Core utilities
export {
  FmcpElement,
  type FmcpElementConfig,
  type FmcpRenderEventDetail,
  parseAttributeValue,
  kebabToCamel,
  camelToKebab,
  getObservedAttributesFromSchema,
  mergeAttributeIntoOptions,
  type ParsedAttribute,
} from './core';

// Element classes
export { FmcpButton, FmcpCard, FmcpAlert, FmcpBadge, FmcpInput, FmcpSelect } from './elements';

// Registration functions
export {
  registerAllComponents,
  registerFmcpButton,
  registerFmcpCard,
  registerFmcpAlert,
  registerFmcpBadge,
  registerFmcpInput,
  registerFmcpSelect,
} from './register';

// Type declarations (side-effect import for JSX types)
export type {
  FmcpButtonProps,
  FmcpCardProps,
  FmcpAlertProps,
  FmcpBadgeProps,
  FmcpInputProps,
  FmcpSelectProps,
} from './types';

// Import types for side-effect (JSX augmentation)
import './types';
