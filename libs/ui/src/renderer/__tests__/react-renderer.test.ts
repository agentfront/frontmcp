/**
 * React JSX Renderer Tests
 */

import { ReactJsxRenderer, isReactJsx, parseImports, stripImports, rewriteExportDefault } from '../react';

describe('ReactJsxRenderer', () => {
  const renderer = new ReactJsxRenderer();

  // ============================================
  // isReactJsx detection
  // ============================================

  describe('isReactJsx()', () => {
    it('should detect function component with JSX return', () => {
      const code = `function Greeting() {
  return <div>Hello</div>;
}`;
      expect(isReactJsx(code)).toBe(true);
    });

    it('should detect arrow component with JSX', () => {
      const code = `const App = () => (
  <div>Hello</div>
)`;
      expect(isReactJsx(code)).toBe(true);
    });

    it('should detect class component', () => {
      const code = `class MyComp extends React.Component {
  render() {
    return <div>Hello</div>;
  }
}`;
      expect(isReactJsx(code)).toBe(true);
    });

    it('should detect arrow with return keyword', () => {
      const code = `const App = () => {
  return <span>test</span>;
}`;
      expect(isReactJsx(code)).toBe(true);
    });

    it('should not detect plain text', () => {
      expect(isReactJsx('hello world')).toBe(false);
    });

    it('should not detect HTML', () => {
      expect(isReactJsx('<div>HTML content</div>')).toBe(false);
    });

    it('should not detect markdown', () => {
      expect(isReactJsx('# Heading\n\nSome text')).toBe(false);
    });

    it('should not detect JSON', () => {
      expect(isReactJsx('{ "type": "bar", "data": [] }')).toBe(false);
    });

    it('should not detect a function without JSX', () => {
      expect(isReactJsx('function sum(a, b) { return a + b; }')).toBe(false);
    });
  });

  // ============================================
  // parseImports
  // ============================================

  describe('parseImports()', () => {
    it('should parse default import with esm.sh URL', () => {
      const code = `import React from 'https://esm.sh/react@19';`;
      const imports = parseImports(code);
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({
        localName: 'React',
        specifier: 'https://esm.sh/react@19',
        named: false,
      });
    });

    it('should parse default import with bare specifier', () => {
      const code = `import React from 'react';`;
      const imports = parseImports(code);
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({
        localName: 'React',
        specifier: 'react',
        named: false,
      });
    });

    it('should parse named imports', () => {
      const code = `import { useState, useEffect } from 'https://esm.sh/react@19';`;
      const imports = parseImports(code);
      expect(imports).toHaveLength(2);
      expect(imports[0]).toMatchObject({ localName: 'useState', named: true });
      expect(imports[1]).toMatchObject({ localName: 'useEffect', named: true });
    });

    it('should parse multiple import lines', () => {
      const code = `import React from 'https://esm.sh/react@19';
import { useState } from 'https://esm.sh/react@19';
import SomeLib from 'https://esm.sh/some-lib@1';`;
      const imports = parseImports(code);
      expect(imports).toHaveLength(3);
      const names = imports.map((i) => i.localName).sort();
      expect(names).toEqual(['React', 'SomeLib', 'useState']);
    });

    it('should return empty array for code with no imports', () => {
      const code = `const x = 42;\nfunction foo() { return x; }`;
      expect(parseImports(code)).toHaveLength(0);
    });

    it('should handle imports without semicolons', () => {
      const code = `import React from 'react'`;
      const imports = parseImports(code);
      expect(imports).toHaveLength(1);
      expect(imports[0].localName).toBe('React');
    });
  });

  // ============================================
  // stripImports
  // ============================================

  describe('stripImports()', () => {
    it('should remove default imports', () => {
      const code = `import React from 'react';
const x = 1;`;
      const result = stripImports(code);
      expect(result).not.toContain('import');
      expect(result).toContain('const x = 1;');
    });

    it('should remove named imports', () => {
      const code = `import { useState } from 'react';
const x = 1;`;
      const result = stripImports(code);
      expect(result).not.toContain('import');
      expect(result).toContain('const x = 1;');
    });

    it('should remove multiple import lines', () => {
      const code = `import React from 'react';
import { useState } from 'react';
const App = () => <div />;`;
      const result = stripImports(code);
      expect(result).not.toContain('import');
      expect(result).toContain('const App');
    });
  });

  // ============================================
  // rewriteExportDefault
  // ============================================

  describe('rewriteExportDefault()', () => {
    it('should rewrite export default identifier', () => {
      expect(rewriteExportDefault('export default MyComp;')).toBe('var __default__ = MyComp;');
    });

    it('should rewrite export default identifier without semicolon', () => {
      expect(rewriteExportDefault('export default MyComp')).toBe('var __default__ = MyComp;');
    });

    it('should rewrite export default function', () => {
      const input = `export default function Greeting() {
  return <div>Hi</div>;
}`;
      const result = rewriteExportDefault(input);
      expect(result).toContain('var __default__ = function Greeting()');
      expect(result).not.toContain('export default');
    });

    it('should rewrite export default class', () => {
      const input = 'export default class MyComp extends React.Component {}';
      const result = rewriteExportDefault(input);
      expect(result).toContain('var __default__ = class MyComp');
      expect(result).not.toContain('export default');
    });

    it('should rewrite export default arrow function', () => {
      const input = 'export default () => <div>Hello</div>';
      const result = rewriteExportDefault(input);
      expect(result).toContain('var __default__ = () =>');
      expect(result).not.toContain('export default');
    });

    it('should rewrite export default arrow with params', () => {
      const input = 'export default (props) => <div>{props.name}</div>';
      const result = rewriteExportDefault(input);
      expect(result).toContain('var __default__ = (props) =>');
    });

    it('should not modify code without export default', () => {
      const input = 'const x = 42;\nfunction foo() { return x; }';
      expect(rewriteExportDefault(input)).toBe(input);
    });
  });

  // ============================================
  // canHandle
  // ============================================

  describe('canHandle()', () => {
    it('should handle JSX components', () => {
      const code = `function App() { return <div>Hello</div>; }`;
      expect(renderer.canHandle(code)).toBe(true);
    });

    it('should not handle plain text', () => {
      expect(renderer.canHandle('hello world')).toBe(false);
    });

    it('should not handle HTML', () => {
      expect(renderer.canHandle('<div>just html</div>')).toBe(false);
    });
  });

  // ============================================
  // render
  // ============================================

  describe('render()', () => {
    it('should return a React element', () => {
      const code = `import React from 'react';\nfunction App() { return <div>Hello</div>; }\nexport default App;`;
      const element = renderer.render(code);
      expect(element).toBeTruthy();
      expect(typeof element.type).toBe('function');
    });

    it('should use default className', () => {
      const code = `function App() { return <div>Hello</div>; }\nexport default App;`;
      const element = renderer.render(code);
      expect(element.props.className).toBe('fmcp-jsx-content');
    });

    it('should use custom className', () => {
      const code = `function App() { return <div>Hello</div>; }\nexport default App;`;
      const element = renderer.render(code, { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });

    it('should pass source as prop', () => {
      const code = `function App() { return <div>Hello</div>; }\nexport default App;`;
      const element = renderer.render(code);
      expect(element.props.source).toBe(code);
    });
  });

  // ============================================
  // metadata
  // ============================================

  describe('metadata', () => {
    it('should have type "jsx"', () => {
      expect(renderer.type).toBe('jsx');
    });
  });
});
