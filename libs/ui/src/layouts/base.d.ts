/**
 * Base Layout System
 *
 * Provides the foundation for all FrontMCP UI pages with:
 * - Platform-aware rendering (OpenAI, Claude, etc.)
 * - Theme integration
 * - CDN resource management
 * - Responsive layouts
 */
import { type PlatformCapabilities, type ThemeConfig, type DeepPartial } from '../theme';
/**
 * Page type determines the layout structure
 */
export type PageType =
  | 'auth'
  | 'consent'
  | 'error'
  | 'loading'
  | 'success'
  | 'dashboard'
  | 'widget'
  | 'resource'
  | 'custom';
/**
 * Layout size/width options
 */
export type LayoutSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full';
/**
 * Background style options
 */
export type BackgroundStyle = 'solid' | 'gradient' | 'pattern' | 'none';
/**
 * Layout alignment options
 */
export type LayoutAlignment = 'center' | 'top' | 'start';
/**
 * Base layout configuration options
 */
export interface BaseLayoutOptions {
  /** Page title (will be suffixed with branding) */
  title: string;
  /** Page type for layout structure */
  pageType?: PageType;
  /** Content width */
  size?: LayoutSize;
  /** Content alignment */
  alignment?: LayoutAlignment;
  /** Background style */
  background?: BackgroundStyle;
  /** Optional page description for meta tag */
  description?: string;
  /** Target platform capabilities */
  platform?: PlatformCapabilities;
  /** Theme configuration (deep partial - nested properties are also optional) */
  theme?: DeepPartial<ThemeConfig>;
  /** Include HTMX (default: based on platform) */
  includeHtmx?: boolean;
  /** Include Alpine.js (default: false) */
  includeAlpine?: boolean;
  /** Include Lucide icons (default: false) */
  includeIcons?: boolean;
  /** Additional head content */
  headExtra?: string;
  /** Additional body attributes */
  bodyAttrs?: Record<string, string>;
  /** Custom body classes */
  bodyClass?: string;
  /** Title suffix/branding */
  titleSuffix?: string;
  /** Favicon URL */
  favicon?: string;
  /** Open Graph meta tags */
  og?: {
    title?: string;
    description?: string;
    image?: string;
    type?: string;
  };
}
export { escapeHtml } from '../utils';
/**
 * Build the complete HTML document
 *
 * @param content - The page content (HTML string)
 * @param options - Layout configuration options
 * @returns Complete HTML document string
 */
export declare function baseLayout(content: string, options: BaseLayoutOptions): string;
/**
 * Create a layout builder with preset options.
 * The returned function accepts optional options that extend/override the defaults.
 * If defaults include `title`, the returned function's options are fully optional.
 */
export declare function createLayoutBuilder(
  defaults: Partial<BaseLayoutOptions>,
): (content: string, options?: Partial<BaseLayoutOptions>) => string;
//# sourceMappingURL=base.d.ts.map
