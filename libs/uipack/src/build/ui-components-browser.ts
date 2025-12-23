/**
 * Browser-Compatible UI Components
 *
 * This module generates browser-compatible React component code that matches
 * the real components from @frontmcp/ui/react. These are used in the vendor
 * runtime for static HTML generation.
 *
 * Key differences from the React components:
 * - Uses window.React.createElement instead of JSX
 * - All style utilities are inlined
 * - No external imports
 *
 * This ensures that when customer code imports:
 *   import { Card, Button, Badge } from '@frontmcp/ui/react';
 *
 * The components behave identically to the real React components.
 *
 * @packageDocumentation
 */

import {
  // Card
  CARD_VARIANTS,
  CARD_SIZES,
  type CardVariant,
  type CardSize,
  // Button
  BUTTON_VARIANTS,
  BUTTON_SIZES,
  BUTTON_ICON_SIZES,
  BUTTON_BASE_CLASSES,
  LOADING_SPINNER,
  type ButtonVariant,
  type ButtonSize,
  // Badge
  BADGE_VARIANTS,
  BADGE_SIZES,
  BADGE_DOT_SIZES,
  BADGE_DOT_VARIANTS,
  type BadgeVariant,
  type BadgeSize,
  // Alert
  ALERT_VARIANTS,
  ALERT_BASE_CLASSES,
  ALERT_ICONS,
  CLOSE_ICON,
  type AlertVariant,
} from '../styles';

/**
 * Options for building browser UI components.
 */
export interface BrowserUIComponentsOptions {
  /** Minify the output */
  minify?: boolean;
}

/**
 * Build the style constants as browser-compatible JavaScript.
 * These are the variant maps and utility functions used by all components.
 */
export function buildStyleConstants(): string {
  return `
// Style Constants (from @frontmcp/uipack/styles)
var CARD_VARIANTS = ${JSON.stringify(CARD_VARIANTS)};
var CARD_SIZES = ${JSON.stringify(CARD_SIZES)};

var BUTTON_VARIANTS = ${JSON.stringify(BUTTON_VARIANTS)};
var BUTTON_SIZES = ${JSON.stringify(BUTTON_SIZES)};
var BUTTON_ICON_SIZES = ${JSON.stringify(BUTTON_ICON_SIZES)};
var BUTTON_BASE_CLASSES = ${JSON.stringify(BUTTON_BASE_CLASSES)};
var LOADING_SPINNER = ${JSON.stringify(LOADING_SPINNER)};

var BADGE_VARIANTS = ${JSON.stringify(BADGE_VARIANTS)};
var BADGE_SIZES = ${JSON.stringify(BADGE_SIZES)};
var BADGE_DOT_SIZES = ${JSON.stringify(BADGE_DOT_SIZES)};
var BADGE_DOT_VARIANTS = ${JSON.stringify(BADGE_DOT_VARIANTS)};

var ALERT_VARIANTS = ${JSON.stringify(ALERT_VARIANTS)};
var ALERT_BASE_CLASSES = ${JSON.stringify(ALERT_BASE_CLASSES)};
var ALERT_ICONS = ${JSON.stringify(ALERT_ICONS)};
var CLOSE_ICON = ${JSON.stringify(CLOSE_ICON)};

// Utility: Join CSS classes, filtering out falsy values
function cn() {
  var result = [];
  for (var i = 0; i < arguments.length; i++) {
    if (arguments[i]) result.push(arguments[i]);
  }
  return result.join(' ');
}
`;
}

/**
 * Build the Card component as browser-compatible JavaScript.
 * Matches the full Card component from @frontmcp/ui/react/Card.tsx
 */
export function buildCardComponent(): string {
  return `
// Card Component (matches @frontmcp/ui/react/Card)
window.Card = function Card(props) {
  var title = props.title;
  var subtitle = props.subtitle;
  var headerActions = props.headerActions;
  var footer = props.footer;
  var variant = props.variant || 'default';
  var size = props.size || 'md';
  var className = props.className;
  var id = props.id;
  var clickable = props.clickable;
  var href = props.href;
  var children = props.children;

  var variantClasses = CARD_VARIANTS[variant] || CARD_VARIANTS.default;
  var sizeClasses = CARD_SIZES[size] || CARD_SIZES.md;
  var clickableClasses = clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : '';
  var allClasses = cn(variantClasses, sizeClasses, clickableClasses, className);

  var hasHeader = title || subtitle || headerActions;

  var headerElement = hasHeader ? React.createElement('div', {
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

  var footerElement = footer ? React.createElement('div', {
    className: 'mt-4 pt-4 border-t border-divider'
  }, footer) : null;

  var content = React.createElement(React.Fragment, null, [
    headerElement,
    children,
    footerElement
  ]);

  if (href) {
    return React.createElement('a', {
      href: href,
      className: allClasses,
      id: id
    }, content);
  }

  return React.createElement('div', {
    className: allClasses,
    id: id
  }, content);
};
`;
}

/**
 * Build the Button component as browser-compatible JavaScript.
 * Matches the full Button component from @frontmcp/ui/react/Button.tsx
 */
export function buildButtonComponent(): string {
  return `
// Button Component (matches @frontmcp/ui/react/Button)
window.Button = function Button(props) {
  var variant = props.variant || 'primary';
  var size = props.size || 'md';
  var disabled = props.disabled || false;
  var loading = props.loading || false;
  var fullWidth = props.fullWidth || false;
  var iconPosition = props.iconPosition || 'left';
  var icon = props.icon;
  var iconOnly = props.iconOnly || false;
  var type = props.type || 'button';
  var className = props.className;
  var onClick = props.onClick;
  var children = props.children;

  var variantClasses = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;
  var sizeClasses = iconOnly
    ? (BUTTON_ICON_SIZES[size] || BUTTON_ICON_SIZES.md)
    : (BUTTON_SIZES[size] || BUTTON_SIZES.md);

  var disabledClasses = (disabled || loading) ? 'opacity-50 cursor-not-allowed' : '';
  var widthClasses = fullWidth ? 'w-full' : '';

  var allClasses = cn(BUTTON_BASE_CLASSES, variantClasses, sizeClasses, disabledClasses, widthClasses, className);

  var iconElement = icon ? React.createElement('span', {
    className: iconPosition === 'left' ? 'mr-2' : 'ml-2'
  }, icon) : null;

  var loadingSpinner = loading ? React.createElement('span', {
    className: 'mr-2',
    dangerouslySetInnerHTML: { __html: LOADING_SPINNER }
  }) : null;

  return React.createElement('button', {
    type: type,
    className: allClasses,
    disabled: disabled || loading,
    onClick: onClick
  }, [
    loadingSpinner,
    !loading && icon && iconPosition === 'left' ? iconElement : null,
    !iconOnly ? children : null,
    !loading && icon && iconPosition === 'right' ? iconElement : null
  ]);
};
`;
}

/**
 * Build the Badge component as browser-compatible JavaScript.
 * Matches the full Badge component from @frontmcp/ui/react/Badge.tsx
 */
export function buildBadgeComponent(): string {
  return `
// Badge Component (matches @frontmcp/ui/react/Badge)
window.Badge = function Badge(props) {
  var variant = props.variant || 'default';
  var size = props.size || 'md';
  var pill = props.pill || false;
  var icon = props.icon;
  var dot = props.dot || false;
  var className = props.className;
  var removable = props.removable || false;
  var onRemove = props.onRemove;
  var children = props.children;

  // Handle dot badge (status indicator)
  if (dot) {
    var dotSizeClasses = BADGE_DOT_SIZES[size] || BADGE_DOT_SIZES.md;
    var dotVariantClasses = BADGE_DOT_VARIANTS[variant] || BADGE_DOT_VARIANTS.default;
    var dotClasses = cn('inline-block rounded-full', dotSizeClasses, dotVariantClasses, className);

    var label = typeof children === 'string' ? children : undefined;

    return React.createElement('span', {
      className: dotClasses,
      'aria-label': label,
      title: label
    });
  }

  var variantClasses = BADGE_VARIANTS[variant] || BADGE_VARIANTS.default;
  var sizeClasses = BADGE_SIZES[size] || BADGE_SIZES.md;

  var baseClasses = cn(
    'inline-flex items-center font-medium',
    pill ? 'rounded-full' : 'rounded-md',
    variantClasses,
    sizeClasses,
    className
  );

  var closeButton = removable ? React.createElement('button', {
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

  return React.createElement('span', {
    className: baseClasses
  }, [
    icon ? React.createElement('span', { key: 'icon', className: 'mr-1' }, icon) : null,
    children,
    closeButton
  ]);
};
`;
}

/**
 * Build the Alert component as browser-compatible JavaScript.
 * Matches the full Alert component from @frontmcp/ui/react/Alert.tsx
 */
export function buildAlertComponent(): string {
  return `
// Alert Component (matches @frontmcp/ui/react/Alert)
window.Alert = function Alert(props) {
  var variant = props.variant || 'info';
  var title = props.title;
  var icon = props.icon;
  var showIcon = props.showIcon !== false;
  var dismissible = props.dismissible || false;
  var onDismiss = props.onDismiss;
  var className = props.className;
  var children = props.children;

  var variantStyles = ALERT_VARIANTS[variant] || ALERT_VARIANTS.info;
  var allClasses = cn(ALERT_BASE_CLASSES, variantStyles.container, className);

  // Use custom icon or default variant icon
  var iconContent = icon || (showIcon ? React.createElement('span', {
    className: cn('flex-shrink-0', variantStyles.icon),
    dangerouslySetInnerHTML: { __html: ALERT_ICONS[variant] || ALERT_ICONS.info }
  }) : null);

  var dismissButton = dismissible ? React.createElement('button', {
    type: 'button',
    className: 'flex-shrink-0 ml-3 hover:opacity-70 transition-opacity',
    'aria-label': 'Dismiss',
    onClick: onDismiss
  }, React.createElement('span', {
    dangerouslySetInnerHTML: { __html: CLOSE_ICON }
  })) : null;

  return React.createElement('div', {
    className: allClasses,
    role: 'alert'
  }, React.createElement('div', {
    className: 'flex'
  }, [
    iconContent ? React.createElement('div', {
      key: 'icon',
      className: 'flex-shrink-0 mr-3'
    }, iconContent) : null,
    React.createElement('div', {
      key: 'content',
      className: 'flex-1'
    }, [
      title ? React.createElement('h4', {
        key: 'title',
        className: 'font-semibold mb-1'
      }, title) : null,
      React.createElement('div', {
        key: 'body',
        className: 'text-sm'
      }, children)
    ]),
    dismissButton
  ]));
};
`;
}

/**
 * Build the namespace export that maps all components and hooks.
 * This is what gets assigned to window.frontmcp_ui_namespaceObject.
 */
export function buildNamespaceExport(): string {
  return `
// Export to namespace (for require('@frontmcp/ui/react') shim)
window.frontmcp_ui_namespaceObject = Object.assign({}, window.React || {}, {
  // Hooks
  useToolOutput: window.useToolOutput,
  useToolInput: window.useToolInput,
  useMcpBridgeContext: function() { return window.__frontmcp.context; },
  useMcpBridge: function() { return window.__frontmcp.context; },
  useCallTool: function() {
    return function(name, args) {
      if (window.__frontmcp.context.callTool) {
        return window.__frontmcp.context.callTool(name, args);
      }
      console.warn('[FrontMCP] callTool not available');
      return Promise.resolve(null);
    };
  },
  useTheme: function() { return window.__frontmcp.theme || 'light'; },
  useDisplayMode: function() { return window.__frontmcp.displayMode || 'embedded'; },
  useHostContext: function() { return window.__frontmcp.hostContext || {}; },
  useCapability: function(cap) { return window.__frontmcp.capabilities?.[cap] || false; },
  useStructuredContent: function() { return window.__frontmcp.getState().structuredContent; },
  useToolCalls: function() { return []; },
  useSendMessage: function() { return function() { return Promise.resolve(); }; },
  useOpenLink: function() { return function() {}; },

  // Components
  Card: window.Card,
  Badge: window.Badge,
  Button: window.Button,
  Alert: window.Alert,

  // Re-export React stuff for convenience
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

/**
 * Build all UI components as browser-compatible JavaScript.
 * This is the complete runtime that replaces buildUIComponentsRuntime().
 */
export function buildUIComponentsRuntime(options: BrowserUIComponentsOptions = {}): string {
  const parts = [
    '// UI Components (Browser-Compatible)',
    '// Generated from @frontmcp/ui/react components',
    '(function() {',
    buildStyleConstants(),
    buildCardComponent(),
    buildButtonComponent(),
    buildBadgeComponent(),
    buildAlertComponent(),
    buildNamespaceExport(),
    '})();',
  ];

  let script = parts.join('\n');

  if (options.minify) {
    script = minifyScript(script);
  }

  return script;
}

/**
 * Simple minification that preserves strings.
 */
function minifyScript(script: string): string {
  return script
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/\n\s*\n/g, '\n')
    .replace(/^\s+/gm, '')
    .trim();
}

// Export types for reference
export type { CardVariant, CardSize, ButtonVariant, ButtonSize, BadgeVariant, BadgeSize, AlertVariant };
