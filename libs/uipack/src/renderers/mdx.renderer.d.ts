/**
 * MDX Renderer
 *
 * Handles MDX templates - Markdown with embedded JSX components.
 * Uses @mdx-js/mdx for compilation and react-dom/server for SSR.
 *
 * MDX allows mixing Markdown with React components:
 * - Markdown headings, lists, code blocks
 * - JSX component tags: `<Card />`
 * - JS expressions: `{output.items.map(...)}`
 * - Frontmatter for metadata
 */
import type { TemplateContext } from '../runtime/types';
import type { PlatformCapabilities } from '../theme';
import type { UIRenderer, TranspileResult, TranspileOptions, RenderOptions, RuntimeScripts } from './types';
/**
 * Types this renderer can handle - MDX strings.
 */
type MdxTemplate = string;
/**
 * MDX Renderer Implementation.
 *
 * Compiles MDX (Markdown + JSX) to React components using @mdx-js/mdx,
 * then renders to HTML using react-dom/server.
 *
 * @example Basic MDX template
 * ```typescript
 * @Tool({
 *   ui: {
 *     template: `
 * # User Profile
 *
 * <UserCard name={output.name} email={output.email} />
 *
 * ## Recent Activity
 * {output.items.map(item => <ActivityItem key={item.id} {...item} />)}
 *     `,
 *     mdxComponents: { UserCard, ActivityItem }
 *   }
 * })
 * ```
 *
 * @example MDX with frontmatter
 * ```typescript
 * @Tool({
 *   ui: {
 *     template: `
 * ---
 * title: Dashboard
 * ---
 *
 * # {frontmatter.title}
 *
 * <Dashboard data={output} />
 *     `
 *   }
 * })
 * ```
 */
export declare class MdxRenderer implements UIRenderer<MdxTemplate> {
  readonly type: 'mdx';
  readonly priority = 10;
  /**
   * Lazy-loaded modules.
   */
  private React;
  private ReactDOMServer;
  private jsxRuntime;
  private mdxEvaluate;
  /**
   * Check if this renderer can handle the given template.
   *
   * Accepts strings containing MDX syntax (Markdown + JSX).
   */
  canHandle(template: unknown): template is MdxTemplate;
  /**
   * Transpile MDX to executable JavaScript.
   *
   * Uses @mdx-js/mdx to compile MDX source to a module.
   * Note: For MDX, we use evaluate() which combines compile + run,
   * so this method just returns the source hash for caching purposes.
   */
  transpile(template: MdxTemplate, _options?: TranspileOptions): Promise<TranspileResult>;
  /**
   * Render MDX template to HTML string.
   *
   * Uses @mdx-js/mdx's evaluate() for clean compilation + execution,
   * then renders the resulting React component to HTML via SSR.
   */
  render<In, Out>(template: MdxTemplate, context: TemplateContext<In, Out>, options?: RenderOptions): Promise<string>;
  /**
   * Get runtime scripts for client-side functionality.
   */
  getRuntimeScripts(platform: PlatformCapabilities): RuntimeScripts;
  /**
   * Load React and ReactDOMServer modules.
   */
  private loadReact;
  /**
   * Load @mdx-js/mdx evaluate function.
   *
   * evaluate() is the cleanest way to run MDX - it combines
   * compile and run in a single step, handling all the runtime
   * injection automatically.
   */
  private loadMdx;
}
/**
 * Singleton instance of the MDX renderer.
 */
export declare const mdxRenderer: MdxRenderer;
/**
 * Build MDX hydration script for client-side interactivity.
 *
 * Note: MDX hydration is more complex than React hydration
 * because it needs the MDX runtime and component definitions.
 */
export declare function buildMdxHydrationScript(): string;
export {};
//# sourceMappingURL=mdx.renderer.d.ts.map
