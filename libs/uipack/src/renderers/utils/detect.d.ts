/**
 * Template Type Detection Utilities
 *
 * Provides functions to detect whether a template is:
 * - A React component (imported or inline)
 * - A JSX string (needs runtime transpilation)
 * - MDX content
 * - Plain HTML
 */
/**
 * Check if a value is a React component (FC or class).
 *
 * Detection heuristics:
 * 1. Has $$typeof symbol (React.memo, React.forwardRef, etc.)
 * 2. Has prototype.isReactComponent (class components)
 * 3. Is a function with 0-1 parameters (function components)
 *
 * @param value - Value to check
 * @returns True if it's a React component
 *
 * @example
 * ```typescript
 * const MyComponent = ({ output }) => <div>{output.name}</div>;
 * isReactComponent(MyComponent); // true
 *
 * const htmlFn = (ctx) => `<div>${ctx.output.name}</div>`;
 * isReactComponent(htmlFn); // false (returns string)
 * ```
 */
export declare function isReactComponent(value: unknown): boolean;
/**
 * Check if a function is likely a template builder (returns string).
 *
 * This is a heuristic based on function characteristics.
 *
 * @param fn - Function to check
 * @returns True if likely a template builder function
 */
export declare function isTemplateBuilderFunction(fn: Function): boolean;
/**
 * Check if a string contains JSX syntax.
 *
 * Looks for patterns like:
 * - `<Component` - JSX component tags
 * - `</Component>` - JSX closing tags
 * - `<div className=` - JSX attributes
 * - `return (` followed by JSX
 *
 * @param source - String to check
 * @returns True if string contains JSX
 *
 * @example
 * ```typescript
 * containsJsx('<div>Hello</div>'); // false (just HTML)
 * containsJsx('<MyComponent />'); // true (JSX component)
 * containsJsx('function() { return <div /> }'); // true
 * ```
 */
export declare function containsJsx(source: string): boolean;
/**
 * Check if a string contains MDX syntax.
 *
 * MDX is Markdown with JSX components. Patterns:
 * - Frontmatter: `---\ntitle: ...\n---`
 * - JSX components: `<Component />`
 * - JSX attributes: `className`, `onClick`, `htmlFor`
 * - JS expressions: `{variable}` or `{items.map(...)}`
 * - Import/export statements
 *
 * @param source - String to check
 * @returns True if string contains MDX syntax
 *
 * @example
 * ```typescript
 * containsMdxSyntax('# Title\n<Card />'); // true
 * containsMdxSyntax('# Title\n{data.name}'); // true
 * containsMdxSyntax('<div className="test">...'); // true (JSX attribute)
 * containsMdxSyntax('# Title\nSome text'); // false (just Markdown)
 * ```
 */
export declare function containsMdxSyntax(source: string): boolean;
/**
 * Check if a string is plain HTML (no JSX or MDX).
 *
 * @param source - String to check
 * @returns True if string is plain HTML
 */
export declare function isPlainHtml(source: string): boolean;
/**
 * Detect the type of a template.
 *
 * Priority order:
 * 1. React component (imported, already transpiled)
 * 2. MDX string
 * 3. JSX string (needs transpilation)
 * 4. HTML template function
 * 5. Static HTML string
 *
 * @param template - Template to analyze
 * @returns Detected type and confidence
 */
export declare function detectTemplateType(template: unknown): {
  type: 'react' | 'mdx' | 'jsx-string' | 'html-function' | 'html-string';
  confidence: number;
  reason: string;
};
//# sourceMappingURL=detect.d.ts.map
