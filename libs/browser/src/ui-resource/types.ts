// file: libs/browser/src/ui-resource/types.ts
/**
 * Type definitions for UI Resource Delivery.
 */

// =============================================================================
// UI Resource Options
// =============================================================================

/**
 * Options for creating a UI resource with raw HTML.
 */
export interface CreateUIResourceOptions {
  /**
   * MIME type for the resource content.
   * @default 'text/html'
   */
  mimeType?: UIResourceMimeType;

  /**
   * Description of the UI resource.
   */
  description?: string;

  /**
   * Inline styles to apply to the container.
   */
  styles?: string;

  /**
   * Inline scripts to include.
   */
  scripts?: string;

  /**
   * Additional metadata for the resource.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Supported MIME types for UI resources.
 */
export type UIResourceMimeType =
  | 'text/html'
  | 'text/html;profile=ui'
  | 'text/markdown'
  | 'text/plain'
  | 'application/json';

// =============================================================================
// UI Resource Result
// =============================================================================

/**
 * Result from creating a UI resource.
 */
export interface UIResourceResult {
  /**
   * The unique URI for the resource.
   */
  uri: string;

  /**
   * The HTML content of the resource.
   */
  html: string;

  /**
   * MIME type of the resource.
   */
  mimeType: string;

  /**
   * Metadata to include in tool results (_meta field).
   */
  _meta: {
    resourceUri: string;
    mimeType: string;
  };
}

// =============================================================================
// Tool Result with UI Resource
// =============================================================================

/**
 * Enhanced tool result that includes a UI resource link.
 */
export interface ToolResultWithUI<T = unknown> {
  /**
   * The original tool result data.
   */
  content: T;

  /**
   * Metadata linking to the UI resource.
   */
  _meta: {
    resourceUri: string;
    mimeType: string;
  };
}

// =============================================================================
// Render Options
// =============================================================================

/**
 * Options for rendering HTML content.
 */
export interface RenderOptions {
  /**
   * Whether to include a full HTML document structure.
   * @default false
   */
  fullDocument?: boolean;

  /**
   * Title for the HTML document (only used if fullDocument is true).
   */
  title?: string;

  /**
   * Additional CSS to include.
   */
  css?: string;

  /**
   * Additional JavaScript to include.
   */
  js?: string;

  /**
   * Whether to minify the output.
   * @default false
   */
  minify?: boolean;
}

// =============================================================================
// Component Renderer
// =============================================================================

/**
 * Function that renders a component to HTML.
 */
export type ComponentRenderer<Props = unknown> = (props: Props) => string;

/**
 * Registered component definition.
 */
export interface RegisteredComponent<Props = unknown> {
  /**
   * Component name.
   */
  name: string;

  /**
   * Component description for AI discovery.
   */
  description: string;

  /**
   * Render function that produces HTML.
   */
  render: ComponentRenderer<Props>;

  /**
   * Optional category for organization.
   */
  category?: string;

  /**
   * Optional tags for discovery.
   */
  tags?: string[];
}
