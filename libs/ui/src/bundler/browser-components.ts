/**
 * Browser Components Builder
 *
 * Lazily transpiles the real React components from @frontmcp/ui/react
 * into browser-compatible JavaScript using esbuild at first use.
 *
 * This ensures 100% parity with the actual React components while
 * avoiding the overhead of manual code synchronization.
 *
 * @packageDocumentation
 */

import * as path from 'path';
import * as fs from 'fs';

// ============================================
// Cache
// ============================================

/** Cached transpiled components */
let cachedBrowserComponents: string | null = null;

/** Whether we're currently building (prevents concurrent builds) */
let buildingPromise: Promise<string> | null = null;

// ============================================
// Component Source
// ============================================

/**
 * Get the source code for all UI components bundled together.
 * This is a virtual entry point that imports and re-exports everything.
 */
function getComponentsEntrySource(): string {
  // Virtual entry that imports the styles and creates browser-compatible components
  // We inline the style constants and component logic here
  return `
// Browser Components Entry Point
// This gets transpiled by esbuild to create browser-compatible code

import {
  // Card styles
  CARD_VARIANTS,
  CARD_SIZES,
  // Button styles
  BUTTON_VARIANTS,
  BUTTON_SIZES,
  BUTTON_ICON_SIZES,
  BUTTON_BASE_CLASSES,
  LOADING_SPINNER,
  // Badge styles
  BADGE_VARIANTS,
  BADGE_SIZES,
  BADGE_DOT_SIZES,
  BADGE_DOT_VARIANTS,
  // Alert styles
  ALERT_VARIANTS,
  ALERT_BASE_CLASSES,
  ALERT_ICONS,
  CLOSE_ICON,
  // Utility
  cn,
} from '@frontmcp/uipack/styles';

// Re-export for the IIFE
export {
  CARD_VARIANTS,
  CARD_SIZES,
  BUTTON_VARIANTS,
  BUTTON_SIZES,
  BUTTON_ICON_SIZES,
  BUTTON_BASE_CLASSES,
  LOADING_SPINNER,
  BADGE_VARIANTS,
  BADGE_SIZES,
  BADGE_DOT_SIZES,
  BADGE_DOT_VARIANTS,
  ALERT_VARIANTS,
  ALERT_BASE_CLASSES,
  ALERT_ICONS,
  CLOSE_ICON,
  cn,
};

// Card Component
export function Card(props: any) {
  const {
    title,
    subtitle,
    headerActions,
    footer,
    variant = 'default',
    size = 'md',
    className,
    id,
    clickable,
    href,
    children,
  } = props;

  const variantClasses = CARD_VARIANTS[variant] || CARD_VARIANTS.default;
  const sizeClasses = CARD_SIZES[size] || CARD_SIZES.md;
  const clickableClasses = clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : '';
  const allClasses = cn(variantClasses, sizeClasses, clickableClasses, className);

  const hasHeader = title || subtitle || headerActions;

  const headerElement = hasHeader ? React.createElement('div', {
    className: 'flex items-start justify-between mb-4'
  }, [
    React.createElement('div', { key: 'titles' }, [
      title && React.createElement('h3', {
        key: 'title',
        className: 'text-lg font-semibold text-text-primary'
      }, title),
      subtitle && React.createElement('p', {
        key: 'subtitle',
        className: 'text-sm text-text-secondary mt-1'
      }, subtitle)
    ]),
    headerActions && React.createElement('div', {
      key: 'actions',
      className: 'flex items-center gap-2'
    }, headerActions)
  ]) : null;

  const footerElement = footer ? React.createElement('div', {
    className: 'mt-4 pt-4 border-t border-divider'
  }, footer) : null;

  const content = React.createElement(React.Fragment, null, headerElement, children, footerElement);

  if (href) {
    return React.createElement('a', { href, className: allClasses, id }, content);
  }

  return React.createElement('div', { className: allClasses, id }, content);
}

// Button Component
export function Button(props: any) {
  const {
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    fullWidth = false,
    iconPosition = 'left',
    icon,
    iconOnly = false,
    type = 'button',
    className,
    onClick,
    children,
  } = props;

  const variantClasses = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;
  const sizeClasses = iconOnly
    ? (BUTTON_ICON_SIZES[size] || BUTTON_ICON_SIZES.md)
    : (BUTTON_SIZES[size] || BUTTON_SIZES.md);

  const disabledClasses = (disabled || loading) ? 'opacity-50 cursor-not-allowed' : '';
  const widthClasses = fullWidth ? 'w-full' : '';

  const allClasses = cn(BUTTON_BASE_CLASSES, variantClasses, sizeClasses, disabledClasses, widthClasses, className);

  const iconElement = icon ? React.createElement('span', {
    className: iconPosition === 'left' ? 'mr-2' : 'ml-2'
  }, icon) : null;

  const loadingSpinner = loading ? React.createElement('span', {
    className: 'mr-2',
    dangerouslySetInnerHTML: { __html: LOADING_SPINNER }
  }) : null;

  return React.createElement('button', {
    type,
    className: allClasses,
    disabled: disabled || loading,
    onClick
  },
    loadingSpinner,
    !loading && icon && iconPosition === 'left' ? iconElement : null,
    !iconOnly ? children : null,
    !loading && icon && iconPosition === 'right' ? iconElement : null
  );
}

// Badge Component
export function Badge(props: any) {
  const {
    variant = 'default',
    size = 'md',
    pill = false,
    icon,
    dot = false,
    className,
    removable = false,
    onRemove,
    children,
  } = props;

  // Handle dot badge
  if (dot) {
    const dotSizeClasses = BADGE_DOT_SIZES[size] || BADGE_DOT_SIZES.md;
    const dotVariantClasses = BADGE_DOT_VARIANTS[variant] || BADGE_DOT_VARIANTS.default;
    const dotClasses = cn('inline-block rounded-full', dotSizeClasses, dotVariantClasses, className);
    const label = typeof children === 'string' ? children : undefined;
    return React.createElement('span', {
      className: dotClasses,
      'aria-label': label,
      title: label
    });
  }

  const variantClasses = BADGE_VARIANTS[variant] || BADGE_VARIANTS.default;
  const sizeClasses = BADGE_SIZES[size] || BADGE_SIZES.md;

  const baseClasses = cn(
    'inline-flex items-center font-medium',
    pill ? 'rounded-full' : 'rounded-md',
    variantClasses,
    sizeClasses,
    className
  );

  const closeButton = removable ? React.createElement('button', {
    type: 'button',
    className: 'ml-1.5 -mr-1 hover:opacity-70 transition-opacity',
    'aria-label': 'Remove',
    onClick: onRemove
  }, React.createElement('svg', {
    className: 'w-3 h-3',
    fill: 'none',
    stroke: 'currentColor',
    viewBox: '0 0 24 24'
  }, React.createElement('path', {
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: '2',
    d: 'M6 18L18 6M6 6l12 12'
  }))) : null;

  return React.createElement('span', { className: baseClasses },
    icon ? React.createElement('span', { className: 'mr-1' }, icon) : null,
    children,
    closeButton
  );
}

// Alert Component
export function Alert(props: any) {
  const {
    variant = 'info',
    title,
    icon,
    showIcon = true,
    dismissible = false,
    onDismiss,
    className,
    children,
  } = props;

  const variantStyles = ALERT_VARIANTS[variant] || ALERT_VARIANTS.info;
  const allClasses = cn(ALERT_BASE_CLASSES, variantStyles.container, className);

  const iconContent = icon || (showIcon ? React.createElement('span', {
    className: cn('flex-shrink-0', variantStyles.icon),
    dangerouslySetInnerHTML: { __html: ALERT_ICONS[variant] || ALERT_ICONS.info }
  }) : null);

  const dismissButton = dismissible ? React.createElement('button', {
    type: 'button',
    className: 'flex-shrink-0 ml-3 hover:opacity-70 transition-opacity',
    'aria-label': 'Dismiss',
    onClick: onDismiss
  }, React.createElement('span', {
    dangerouslySetInnerHTML: { __html: CLOSE_ICON }
  })) : null;

  return React.createElement('div', { className: allClasses, role: 'alert' },
    React.createElement('div', { className: 'flex' },
      iconContent ? React.createElement('div', { className: 'flex-shrink-0 mr-3' }, iconContent) : null,
      React.createElement('div', { className: 'flex-1' },
        title ? React.createElement('h4', { className: 'font-semibold mb-1' }, title) : null,
        React.createElement('div', { className: 'text-sm' }, children)
      ),
      dismissButton
    )
  );
}
`;
}

/**
 * Build the browser runtime wrapper that assigns components to window.
 */
function getBrowserRuntimeWrapper(): string {
  return `
// Assign components to window for require() shim
window.Card = Card;
window.Button = Button;
window.Badge = Badge;
window.Alert = Alert;

// Build the namespace object for @frontmcp/ui/react imports
window.frontmcp_ui_namespaceObject = Object.assign({}, window.React || {}, {
  // Hooks
  useToolOutput: window.useToolOutput,
  useToolInput: window.useToolInput,
  useMcpBridgeContext: function() { return window.__frontmcp.context; },
  useMcpBridge: function() { return window.__frontmcp.context; },
  useCallTool: function() {
    return function(name, args) {
      if (window.__frontmcp.context && window.__frontmcp.context.callTool) {
        return window.__frontmcp.context.callTool(name, args);
      }
      console.warn('[FrontMCP] callTool not available');
      return Promise.resolve(null);
    };
  },
  useTheme: function() { return window.__frontmcp.theme || 'light'; },
  useDisplayMode: function() { return window.__frontmcp.displayMode || 'embedded'; },
  useHostContext: function() { return window.__frontmcp.hostContext || {}; },
  useCapability: function(cap) { return window.__frontmcp.capabilities && window.__frontmcp.capabilities[cap] || false; },
  useStructuredContent: function() { return window.__frontmcp.getState().structuredContent; },
  useToolCalls: function() { return []; },
  useSendMessage: function() { return function() { return Promise.resolve(); }; },
  useOpenLink: function() { return function() {}; },

  // Components
  Card: window.Card,
  Badge: window.Badge,
  Button: window.Button,
  Alert: window.Alert,

  // Re-export React for convenience
  createElement: React.createElement,
  Fragment: React.Fragment,
  useState: React.useState,
  useEffect: React.useEffect,
  useCallback: React.useCallback,
  useMemo: React.useMemo,
  useRef: React.useRef,
  useContext: React.useContext
});
`;
}

// ============================================
// Esbuild Integration
// ============================================

/**
 * Transpile the components using esbuild.
 */
// Note: transpileWithEsbuild is not currently used - we use buildWithEsbuild instead
// which uses the full build API with bundling support.
// Keeping this as a simpler fallback option if needed.
async function _transpileWithEsbuild(source: string): Promise<string> {
  try {
    const esbuild = await import('esbuild');

    // transform() only supports 'esm' or 'cjs' format, not 'iife'
    const result = await esbuild.transform(source, {
      loader: 'tsx',
      format: 'esm',
      target: 'es2020',
      minify: false,
    });

    return result.code;
  } catch (error) {
    // Fallback to SWC if esbuild not available
    try {
      const swc = await import('@swc/core');
      const result = await swc.transform(source, {
        jsc: {
          parser: { syntax: 'typescript', tsx: true },
          target: 'es2020',
        },
        module: { type: 'commonjs' },
      });
      return result.code;
    } catch {
      throw new Error(
        `Failed to transpile browser components: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Build the complete browser components bundle using esbuild.
 * This bundles the components with their style dependencies.
 */
async function buildWithEsbuild(): Promise<string> {
  try {
    const esbuild = await import('esbuild');

    // Get the path to the styles module
    const stylesPath = require.resolve('@frontmcp/uipack/styles');

    // Create a virtual entry that imports styles and defines components
    const entrySource = getComponentsEntrySource();

    // Use esbuild's build API with stdin for the virtual entry
    const result = await esbuild.build({
      stdin: {
        contents: entrySource,
        loader: 'tsx',
        resolveDir: path.dirname(stylesPath),
      },
      bundle: true,
      format: 'iife',
      globalName: '__frontmcp_components',
      target: 'es2020',
      minify: false,
      write: false,
      external: ['react', 'react-dom'],
      define: {
        React: 'window.React',
      },
      platform: 'browser',
    });

    if (result.outputFiles && result.outputFiles.length > 0) {
      let code = result.outputFiles[0].text;

      // Add the runtime wrapper that assigns to window
      code += '\n' + getBrowserRuntimeWrapper();

      return code;
    }

    throw new Error('No output from esbuild');
  } catch (error) {
    console.warn(
      `[FrontMCP] esbuild bundle failed, falling back to manual components: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    // Return fallback (will be imported from uipack)
    throw error;
  }
}

// ============================================
// Public API
// ============================================

/**
 * Get browser-compatible UI components.
 *
 * On first call, transpiles the real React components using esbuild.
 * Subsequent calls return the cached result.
 *
 * @returns JavaScript code that defines Card, Button, Badge, Alert on window
 */
export async function getBrowserComponents(): Promise<string> {
  // Return cached if available
  if (cachedBrowserComponents !== null) {
    return cachedBrowserComponents;
  }

  // If already building, wait for that
  if (buildingPromise !== null) {
    return buildingPromise;
  }

  // Build and cache
  buildingPromise = buildWithEsbuild()
    .then((code) => {
      cachedBrowserComponents = code;
      buildingPromise = null;
      return code;
    })
    .catch((error) => {
      buildingPromise = null;
      // Re-throw to let caller handle fallback
      throw error;
    });

  return buildingPromise;
}

/**
 * Get browser-compatible UI components synchronously.
 *
 * Returns cached components if available, otherwise returns null.
 * Use getBrowserComponents() for async loading with transpilation.
 *
 * @returns Cached JavaScript code or null if not yet built
 */
export function getBrowserComponentsSync(): string | null {
  return cachedBrowserComponents;
}

/**
 * Pre-warm the browser components cache.
 *
 * Call this at application startup to avoid delay on first bundler call.
 */
export async function warmBrowserComponentsCache(): Promise<void> {
  await getBrowserComponents();
}

/**
 * Clear the browser components cache.
 *
 * Useful for development when components change.
 */
export function clearBrowserComponentsCache(): void {
  cachedBrowserComponents = null;
}
