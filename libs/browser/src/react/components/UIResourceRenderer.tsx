// file: libs/browser/src/react/components/UIResourceRenderer.tsx
/**
 * UIResourceRenderer component for rendering tool output.
 *
 * @example
 * ```tsx
 * import { UIResourceRenderer } from '@frontmcp/browser/react';
 *
 * function ToolResult({ result }) {
 *   return <UIResourceRenderer resource={result} />;
 * }
 * ```
 */

import React, { useMemo } from 'react';
import { useFrontMcpContext } from '../context';

/**
 * UI Resource type returned by tools.
 */
export interface UIResource {
  type: 'ui-resource';
  component: string;
  props: Record<string, unknown>;
  renderer?: string;
  html?: string;
  markdown?: string;
  text?: string;
}

/**
 * Type guard for UI resource.
 */
export function isUIResource(value: unknown): value is UIResource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type: unknown }).type === 'ui-resource'
  );
}

/**
 * Props for UIResourceRenderer component.
 */
export interface UIResourceRendererProps {
  /**
   * The UI resource to render.
   */
  resource: UIResource | unknown;

  /**
   * Fallback component when resource type is not recognized.
   */
  fallback?: React.ReactNode;

  /**
   * Custom class name for the container.
   */
  className?: string;

  /**
   * Custom styles for the container.
   */
  style?: React.CSSProperties;

  /**
   * Component map for rendering registered components.
   */
  components?: Record<string, React.ComponentType<Record<string, unknown>>>;

  /**
   * Whether to allow HTML rendering (security consideration).
   * @default false
   */
  allowHtml?: boolean;
}

/**
 * Default styles for the renderer.
 */
const defaultStyles = {
  container: {
    width: '100%',
  },
  htmlContainer: {
    width: '100%',
  },
  textContainer: {
    whiteSpace: 'pre-wrap' as const,
    fontFamily: 'inherit',
  },
  errorContainer: {
    padding: '12px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '4px',
    color: '#991b1b',
    fontSize: '14px',
  },
  fallbackContainer: {
    padding: '12px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    color: '#666',
    fontSize: '14px',
  },
};

/**
 * UIResourceRenderer component.
 *
 * Renders UI resources returned by MCP tools. Supports:
 * - HTML content (when allowHtml is true)
 * - Markdown content
 * - Plain text content
 * - Registered components
 */
export function UIResourceRenderer({
  resource,
  fallback,
  className,
  style,
  components = {},
  allowHtml = false,
}: UIResourceRendererProps): React.ReactElement | null {
  const { rendererRegistry } = useFrontMcpContext();

  // Parse the resource
  const uiResource = useMemo((): UIResource | null => {
    if (!resource) {
      return null;
    }

    if (isUIResource(resource)) {
      return resource;
    }

    // Try to parse from MCP tool result
    if (typeof resource === 'object' && resource !== null) {
      const obj = resource as Record<string, unknown>;

      // Check for content array (MCP format)
      const contentArray = obj['content'];
      if (Array.isArray(contentArray)) {
        const textContent = contentArray.find(
          (c): c is { type: string; text: string } => typeof c === 'object' && c !== null && 'text' in c,
        );
        if (textContent?.text) {
          try {
            const parsed = JSON.parse(textContent.text);
            if (isUIResource(parsed)) {
              return parsed;
            }
          } catch {
            // Not JSON, treat as text
            return {
              type: 'ui-resource',
              component: 'text',
              props: {},
              text: textContent.text,
            };
          }
        }
      }
    }

    // Try to treat as plain text
    if (typeof resource === 'string') {
      return {
        type: 'ui-resource',
        component: 'text',
        props: {},
        text: resource,
      };
    }

    return null;
  }, [resource]);

  // Render nothing if no resource
  if (!uiResource) {
    return fallback ? <>{fallback}</> : null;
  }

  // Render HTML content
  if (uiResource.html && allowHtml) {
    return (
      <div
        className={className}
        style={{ ...defaultStyles.htmlContainer, ...style }}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: uiResource.html }}
      />
    );
  }

  // Render text content
  if (uiResource.text) {
    return (
      <div className={className} style={{ ...defaultStyles.textContainer, ...style }}>
        {uiResource.text}
      </div>
    );
  }

  // Render markdown (simplified - just render as text for now)
  if (uiResource.markdown) {
    return (
      <div className={className} style={{ ...defaultStyles.textContainer, ...style }}>
        {uiResource.markdown}
      </div>
    );
  }

  // Try to render a registered component
  const componentName = uiResource.component;

  // Check custom components map first
  if (components[componentName]) {
    const Component = components[componentName];
    return (
      <div className={className} style={{ ...defaultStyles.container, ...style }}>
        <Component {...uiResource.props} />
      </div>
    );
  }

  // Check renderer registry
  if (rendererRegistry && uiResource.renderer) {
    const renderer = rendererRegistry.get(uiResource.renderer);
    if (renderer) {
      // Use the renderer (this is async, might need suspense)
      try {
        const result = renderer.render(uiResource.props);
        if (typeof result === 'string') {
          if (allowHtml && renderer.outputType === 'html') {
            return (
              <div
                className={className}
                style={{ ...defaultStyles.htmlContainer, ...style }}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: result }}
              />
            );
          }
          return (
            <div className={className} style={{ ...defaultStyles.textContainer, ...style }}>
              {result}
            </div>
          );
        }
      } catch (error) {
        return (
          <div className={className} style={{ ...defaultStyles.errorContainer, ...style }}>
            Render error: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        );
      }
    }
  }

  // Fallback
  return (
    <div className={className} style={{ ...defaultStyles.fallbackContainer, ...style }}>
      {fallback ?? `Unknown component: ${componentName}`}
    </div>
  );
}

/**
 * Hook to render a UI resource.
 *
 * @param resource - The resource to render
 * @returns Render utilities
 */
export function useUIResource(resource: unknown): {
  isUIResource: boolean;
  resourceType: string | null;
  component: string | null;
  props: Record<string, unknown>;
} {
  return useMemo(() => {
    if (!isUIResource(resource)) {
      return {
        isUIResource: false,
        resourceType: null,
        component: null,
        props: {},
      };
    }

    return {
      isUIResource: true,
      resourceType: resource.type,
      component: resource.component,
      props: resource.props,
    };
  }, [resource]);
}
