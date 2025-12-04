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
export function isReactComponent(value: unknown): boolean {
  if (typeof value !== 'function') {
    return false;
  }

  const fn = value as Function;

  // Check for React's internal type symbols (memo, forwardRef, lazy)
  const typeofSymbol = (fn as { $$typeof?: symbol }).$$typeof;
  if (typeofSymbol) {
    const symbolString = typeofSymbol.toString();
    return (
      symbolString.includes('react.memo') ||
      symbolString.includes('react.forward_ref') ||
      symbolString.includes('react.lazy')
    );
  }

  // Check for class components
  if (fn.prototype?.isReactComponent) {
    return true;
  }

  // For function components, we can't reliably detect without execution.
  // Heuristic: functions with 0-1 parameters that aren't template builders
  // Template builders receive a context object and return a string.
  // React components receive props and return JSX.Element.

  // Check if function name suggests a component (PascalCase)
  if (fn.name && /^[A-Z]/.test(fn.name)) {
    return true;
  }

  // Function with specific parameter count
  // React FC: (props) => JSX or () => JSX
  // Template: (ctx) => string
  // We can't distinguish these without execution or source analysis

  return false;
}

/**
 * Check if a function is likely a template builder (returns string).
 *
 * This is a heuristic based on function characteristics.
 *
 * @param fn - Function to check
 * @returns True if likely a template builder function
 */
export function isTemplateBuilderFunction(fn: Function): boolean {
  // If it's a React component, it's not a template builder
  if (isReactComponent(fn)) {
    return false;
  }

  // Template builders typically have lowercase names or no name
  if (fn.name && /^[A-Z]/.test(fn.name)) {
    return false;
  }

  // At this point, assume it's a template builder
  return true;
}

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
export function containsJsx(source: string): boolean {
  // JSX component tag (PascalCase)
  if (/<[A-Z][a-zA-Z0-9]*(\s|>|\/)/.test(source)) {
    return true;
  }

  // Self-closing JSX with component
  if (/<[A-Z][a-zA-Z0-9]*[^>]*\/>/.test(source)) {
    return true;
  }

  // JSX with curly braces (expressions)
  if (/<[a-z]+[^>]*\{[^}]+\}/.test(source)) {
    return true;
  }

  // React-specific attributes (className, onClick, etc.)
  if (/\s(className|onClick|onChange|onSubmit|htmlFor)=/.test(source)) {
    return true;
  }

  // JSX fragments
  if (/<>|<\/>|<React\.Fragment>/.test(source)) {
    return true;
  }

  // Arrow function returning JSX
  if (/=>\s*\(?\s*</.test(source)) {
    return true;
  }

  // Function returning JSX
  if (/return\s*\(?\s*</.test(source)) {
    return true;
  }

  return false;
}

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
export function containsMdxSyntax(source: string): boolean {
  // Has JSX component tags (PascalCase)
  if (/<[A-Z][a-zA-Z0-9]*/.test(source)) {
    return true;
  }

  // Has import/export statements (ESM)
  if (/^(import|export)\s/m.test(source)) {
    return true;
  }

  // Has JSX-specific attributes (className, onClick, etc.)
  // These are only valid in JSX, not in regular HTML
  if (/\s(className|onClick|onChange|onSubmit|htmlFor|dangerouslySetInnerHTML)=/.test(source)) {
    return true;
  }

  // Has JS expressions in curly braces (not just HTML attributes)
  // Look for expressions outside of quotes
  if (/\{[^}"'\n]*\}/.test(source) && !/=\s*["'][^"']*\{/.test(source)) {
    return true;
  }

  // Has frontmatter
  if (/^---[\s\S]*?---/m.test(source)) {
    return true;
  }

  // Has JSX fragments
  if (/<>|<\/>/.test(source)) {
    return true;
  }

  return false;
}

/**
 * Check if a string is plain HTML (no JSX or MDX).
 *
 * @param source - String to check
 * @returns True if string is plain HTML
 */
export function isPlainHtml(source: string): boolean {
  return !containsJsx(source) && !containsMdxSyntax(source);
}

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
export function detectTemplateType(template: unknown): {
  type: 'react' | 'mdx' | 'jsx-string' | 'html-function' | 'html-string';
  confidence: number;
  reason: string;
} {
  // Function templates
  if (typeof template === 'function') {
    if (isReactComponent(template)) {
      return {
        type: 'react',
        confidence: 0.9,
        reason: 'Function detected as React component (PascalCase name or React symbols)',
      };
    }

    return {
      type: 'html-function',
      confidence: 0.8,
      reason: 'Function assumed to be HTML template builder',
    };
  }

  // String templates
  if (typeof template === 'string') {
    // Check for MDX first (Markdown + JSX)
    if (containsMdxSyntax(template)) {
      // Could be MDX or just JSX string
      // MDX typically has markdown features (headers, lists, etc.)
      const hasMarkdown = /^#{1,6}\s|^\*\s|^\d+\.\s|^-\s/m.test(template);

      if (hasMarkdown) {
        return {
          type: 'mdx',
          confidence: 0.9,
          reason: 'String contains Markdown with JSX components',
        };
      }

      return {
        type: 'jsx-string',
        confidence: 0.8,
        reason: 'String contains JSX syntax',
      };
    }

    if (containsJsx(template)) {
      return {
        type: 'jsx-string',
        confidence: 0.85,
        reason: 'String contains JSX component tags or expressions',
      };
    }

    return {
      type: 'html-string',
      confidence: 1.0,
      reason: 'Plain HTML string',
    };
  }

  // Default fallback
  return {
    type: 'html-string',
    confidence: 0.5,
    reason: 'Unknown template type, defaulting to HTML',
  };
}
