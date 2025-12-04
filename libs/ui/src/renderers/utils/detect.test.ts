/**
 * Detection Utilities Tests
 */

import {
  isReactComponent,
  isTemplateBuilderFunction,
  containsJsx,
  containsMdxSyntax,
  isPlainHtml,
  detectTemplateType,
} from './detect';

describe('Detection Utilities', () => {
  describe('isReactComponent', () => {
    it('should return false for non-functions', () => {
      expect(isReactComponent('string')).toBe(false);
      expect(isReactComponent(123)).toBe(false);
      expect(isReactComponent(null)).toBe(false);
      expect(isReactComponent(undefined)).toBe(false);
      expect(isReactComponent({})).toBe(false);
      expect(isReactComponent([])).toBe(false);
    });

    it('should detect PascalCase function names as React components', () => {
      function MyComponent() {
        return null;
      }
      expect(isReactComponent(MyComponent)).toBe(true);

      function AnotherWidget() {
        return null;
      }
      expect(isReactComponent(AnotherWidget)).toBe(true);
    });

    it('should not detect lowercase function names as React components', () => {
      function myFunction() {
        return 'string';
      }
      expect(isReactComponent(myFunction)).toBe(false);

      const template = () => '<div>hello</div>';
      expect(isReactComponent(template)).toBe(false);
    });

    it('should detect class components with isReactComponent prototype', () => {
      // Create a class that simulates React class component
      function MyClassComponent() {}
      MyClassComponent.prototype.isReactComponent = true;
      expect(isReactComponent(MyClassComponent)).toBe(true);
    });

    it('should detect React.memo wrapped components', () => {
      const memoComponent = {
        $$typeof: Symbol.for('react.memo'),
      };
      // Functions with $$typeof
      const fn = Object.assign(() => null, { $$typeof: Symbol.for('react.memo') });
      expect(isReactComponent(fn)).toBe(true);
    });

    it('should detect React.forwardRef components', () => {
      const fn = Object.assign(() => null, { $$typeof: Symbol.for('react.forward_ref') });
      expect(isReactComponent(fn)).toBe(true);
    });

    it('should detect React.lazy components', () => {
      const fn = Object.assign(() => null, { $$typeof: Symbol.for('react.lazy') });
      expect(isReactComponent(fn)).toBe(true);
    });
  });

  describe('isTemplateBuilderFunction', () => {
    it('should return true for lowercase named functions', () => {
      function myTemplate() {
        return '<div>hello</div>';
      }
      expect(isTemplateBuilderFunction(myTemplate)).toBe(true);
    });

    it('should return true for arrow functions without names', () => {
      const template = () => '<div>hello</div>';
      expect(isTemplateBuilderFunction(template)).toBe(true);
    });

    it('should return false for React components', () => {
      function MyComponent() {
        return null;
      }
      expect(isTemplateBuilderFunction(MyComponent)).toBe(false);
    });
  });

  describe('containsJsx', () => {
    it('should detect PascalCase component tags', () => {
      expect(containsJsx('<MyComponent />')).toBe(true);
      expect(containsJsx('<UserCard name="test">')).toBe(true);
      expect(containsJsx('<Button onClick={handler}>Click</Button>')).toBe(true);
    });

    it('should detect self-closing JSX components', () => {
      expect(containsJsx('<Avatar size="sm" />')).toBe(true);
      expect(containsJsx('<Icon name="star"/>')).toBe(true);
    });

    it('should detect JSX with curly braces expressions in attributes', () => {
      // Note: curly braces must be in attributes, not just in content
      expect(containsJsx('<div data-value={output.name}>text</div>')).toBe(true);
      expect(containsJsx('<p className={styles.text}>text</p>')).toBe(true);
    });

    it('should not detect curly braces only in content (not JSX attribute)', () => {
      // Curly braces in content are not detected as JSX (could be template literal)
      expect(containsJsx('<div>{output.name}</div>')).toBe(false);
    });

    it('should detect React-specific attributes', () => {
      expect(containsJsx('<div className="test">')).toBe(true);
      expect(containsJsx('<button onClick={handleClick}>')).toBe(true);
      expect(containsJsx('<input onChange={e => setValue(e)}')).toBe(true);
      expect(containsJsx('<form onSubmit={submit}>')).toBe(true);
      expect(containsJsx('<label htmlFor="email">')).toBe(true);
    });

    it('should detect JSX fragments', () => {
      expect(containsJsx('<>content</>')).toBe(true);
      expect(containsJsx('<React.Fragment>content</React.Fragment>')).toBe(true);
    });

    it('should detect arrow function returning JSX', () => {
      expect(containsJsx('() => <div>hello</div>')).toBe(true);
      expect(containsJsx('(props) => (<div>hello</div>)')).toBe(true);
    });

    it('should detect function returning JSX', () => {
      expect(containsJsx('function() { return <div>hello</div>; }')).toBe(true);
      expect(containsJsx('return (<Component />)')).toBe(true);
    });

    it('should not detect plain HTML', () => {
      expect(containsJsx('<div>hello</div>')).toBe(false);
      expect(containsJsx('<p class="text">paragraph</p>')).toBe(false);
      expect(containsJsx('<a href="link">click</a>')).toBe(false);
    });
  });

  describe('containsMdxSyntax', () => {
    it('should detect JSX components in markdown', () => {
      expect(containsMdxSyntax('# Title\n<Card />')).toBe(true);
      expect(containsMdxSyntax('Some text\n<Button>Click</Button>')).toBe(true);
    });

    it('should detect import/export statements', () => {
      expect(containsMdxSyntax('import { Card } from "./card"')).toBe(true);
      expect(containsMdxSyntax('export const meta = {}')).toBe(true);
    });

    it('should detect JS expressions in curly braces', () => {
      expect(containsMdxSyntax('Hello {name}')).toBe(true);
      expect(containsMdxSyntax('{items.map(i => <li>{i}</li>)}')).toBe(true);
    });

    it('should detect frontmatter', () => {
      expect(containsMdxSyntax('---\ntitle: Hello\n---\n# Content')).toBe(true);
    });

    it('should not detect plain markdown', () => {
      expect(containsMdxSyntax('# Title\nSome paragraph text.')).toBe(false);
      expect(containsMdxSyntax('- list item\n- another item')).toBe(false);
    });
  });

  describe('isPlainHtml', () => {
    it('should return true for plain HTML', () => {
      expect(isPlainHtml('<div>hello</div>')).toBe(true);
      expect(isPlainHtml('<p class="text">paragraph</p>')).toBe(true);
    });

    it('should return false for JSX', () => {
      expect(isPlainHtml('<MyComponent />')).toBe(false);
      expect(isPlainHtml('<div className="test">')).toBe(false);
    });

    it('should return false for MDX', () => {
      expect(isPlainHtml('# Title\n<Card />')).toBe(false);
      expect(isPlainHtml('Hello {name}')).toBe(false);
    });
  });

  describe('detectTemplateType', () => {
    it('should detect React components', () => {
      function MyComponent() {
        return null;
      }
      const result = detectTemplateType(MyComponent);
      expect(result.type).toBe('react');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect HTML template functions', () => {
      const template = () => '<div>hello</div>';
      const result = detectTemplateType(template);
      expect(result.type).toBe('html-function');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should detect MDX strings', () => {
      const mdx = '# Title\n<Card name={output.name} />';
      const result = detectTemplateType(mdx);
      expect(result.type).toBe('mdx');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect JSX strings', () => {
      const jsx = '<MyComponent prop={value} />';
      const result = detectTemplateType(jsx);
      expect(result.type).toBe('jsx-string');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should detect plain HTML strings', () => {
      const html = '<div class="container"><p>Hello</p></div>';
      const result = detectTemplateType(html);
      expect(result.type).toBe('html-string');
      expect(result.confidence).toBe(1.0);
    });

    it('should handle unknown types with fallback', () => {
      const result = detectTemplateType(123);
      expect(result.type).toBe('html-string');
      expect(result.confidence).toBe(0.5);
    });
  });
});
