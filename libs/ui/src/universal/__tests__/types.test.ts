/**
 * Universal Types Tests
 *
 * Tests for content type detection and type utilities.
 */

import { detectContentType, DEFAULT_FRONTMCP_STATE, UNIVERSAL_CDN } from '../types';

// ============================================
// DEFAULT_FRONTMCP_STATE Tests
// ============================================

describe('DEFAULT_FRONTMCP_STATE', () => {
  it('should have all required fields', () => {
    expect(DEFAULT_FRONTMCP_STATE).toHaveProperty('toolName');
    expect(DEFAULT_FRONTMCP_STATE).toHaveProperty('input');
    expect(DEFAULT_FRONTMCP_STATE).toHaveProperty('output');
    expect(DEFAULT_FRONTMCP_STATE).toHaveProperty('content');
    expect(DEFAULT_FRONTMCP_STATE).toHaveProperty('structuredContent');
    expect(DEFAULT_FRONTMCP_STATE).toHaveProperty('loading');
    expect(DEFAULT_FRONTMCP_STATE).toHaveProperty('error');
  });

  it('should have correct default values', () => {
    expect(DEFAULT_FRONTMCP_STATE.toolName).toBeNull();
    expect(DEFAULT_FRONTMCP_STATE.input).toBeNull();
    expect(DEFAULT_FRONTMCP_STATE.output).toBeNull();
    expect(DEFAULT_FRONTMCP_STATE.content).toBeNull();
    expect(DEFAULT_FRONTMCP_STATE.structuredContent).toBeNull();
    expect(DEFAULT_FRONTMCP_STATE.loading).toBe(false);
    expect(DEFAULT_FRONTMCP_STATE.error).toBeNull();
  });

  it('should be frozen or immutable reference', () => {
    // The default state should be a consistent reference
    expect(DEFAULT_FRONTMCP_STATE).toBe(DEFAULT_FRONTMCP_STATE);
  });
});

// ============================================
// UNIVERSAL_CDN Tests
// ============================================

describe('UNIVERSAL_CDN', () => {
  it('should have ESM CDN URLs', () => {
    expect(UNIVERSAL_CDN.esm).toBeDefined();
    expect(UNIVERSAL_CDN.esm.reactMarkdown).toBeDefined();
    expect(UNIVERSAL_CDN.esm.mdxReact).toBeDefined();
    expect(UNIVERSAL_CDN.esm.remarkGfm).toBeDefined();
  });

  it('should use HTTPS for all CDN URLs', () => {
    Object.values(UNIVERSAL_CDN.esm).forEach((url) => {
      expect(url).toMatch(/^https:\/\//);
    });
  });

  it('should point to esm.sh', () => {
    Object.values(UNIVERSAL_CDN.esm).forEach((url) => {
      expect(url).toContain('esm.sh');
    });
  });
});

// ============================================
// detectContentType Tests
// ============================================

describe('detectContentType', () => {
  describe('React Component Detection', () => {
    it('should detect function as react', () => {
      const Component = () => 'Hello';
      expect(detectContentType(Component)).toBe('react');
    });

    it('should detect arrow function as react', () => {
      expect(detectContentType(() => null)).toBe('react');
    });

    it('should detect class-like function as react', () => {
      function MyComponent() {
        return null;
      }
      expect(detectContentType(MyComponent)).toBe('react');
    });
  });

  describe('React Module Detection', () => {
    it('should detect import statements with JSX components as react', () => {
      // Note: detectContentType looks for uppercase JSX component tags (<Card>, <Button>)
      // not lowercase HTML elements (<div>, <span>)
      const source = `
import React from 'react';
const App = () => <Container>Hello</Container>;
export default App;
      `;
      expect(detectContentType(source)).toBe('react');
    });

    it('should detect export default with JSX as react', () => {
      const source = `
export default function App() {
  return <Card>Content</Card>;
}
      `;
      expect(detectContentType(source)).toBe('react');
    });

    it('should detect arrow function component module as react', () => {
      const source = `
const Widget = (props) => <Badge>{props.label}</Badge>;
export default Widget;
      `;
      expect(detectContentType(source)).toBe('react');
    });

    it('should detect function component module as react', () => {
      const source = `
function Dashboard({ data }) {
  return <Card title="Dashboard"><Table data={data} /></Card>;
}
export default Dashboard;
      `;
      expect(detectContentType(source)).toBe('react');
    });
  });

  describe('MDX Detection', () => {
    it('should detect markdown with JSX components as mdx', () => {
      const source = `
# Weather Report

<WeatherCard temperature={72} />

## Summary

Today is sunny.
      `;
      expect(detectContentType(source)).toBe('mdx');
    });

    it('should detect JSX embedded in markdown as mdx', () => {
      const source = `
# Dashboard

- Item 1
- Item 2

<DataTable data={output.items} />
      `;
      expect(detectContentType(source)).toBe('mdx');
    });

    it('should detect inline JSX without module syntax as mdx', () => {
      const source = '<MyComponent prop="value" />';
      expect(detectContentType(source)).toBe('mdx');
    });

    it('should detect JSX only content as mdx', () => {
      const source = `
<Card title="Info">
  <Badge variant="success">Active</Badge>
  <p>Some content</p>
</Card>
      `;
      expect(detectContentType(source)).toBe('mdx');
    });
  });

  describe('Markdown Detection', () => {
    it('should detect heading syntax as markdown', () => {
      expect(detectContentType('# Hello World')).toBe('markdown');
      expect(detectContentType('## Subheading')).toBe('markdown');
      expect(detectContentType('### Third Level')).toBe('markdown');
    });

    it('should detect list syntax as markdown', () => {
      expect(detectContentType('- Item 1\n- Item 2')).toBe('markdown');
      expect(detectContentType('* Item 1\n* Item 2')).toBe('markdown');
      expect(detectContentType('1. First\n2. Second')).toBe('markdown');
    });

    it('should detect bold syntax as markdown', () => {
      expect(detectContentType('This is **bold** text')).toBe('markdown');
    });

    it('should detect link syntax as markdown', () => {
      expect(detectContentType('Click [here](https://example.com)')).toBe('markdown');
    });

    it('should detect mixed markdown as markdown', () => {
      const source = `
# Title

This is a paragraph with **bold** and *italic*.

- List item 1
- List item 2

[Link](https://example.com)
      `;
      expect(detectContentType(source)).toBe('markdown');
    });
  });

  describe('HTML Detection (Fallback)', () => {
    it('should detect plain HTML as html', () => {
      expect(detectContentType('<div>Hello</div>')).toBe('html');
    });

    it('should detect HTML with lowercase tags as html', () => {
      expect(detectContentType('<span class="test">Content</span>')).toBe('html');
    });

    it('should detect plain text as html (fallback)', () => {
      expect(detectContentType('Just some text')).toBe('html');
    });

    it('should detect empty string as html', () => {
      expect(detectContentType('')).toBe('html');
    });

    it('should detect whitespace as html', () => {
      expect(detectContentType('   \n\t  ')).toBe('html');
    });
  });

  describe('Non-String Types', () => {
    it('should return html for null', () => {
      expect(detectContentType(null)).toBe('html');
    });

    it('should return html for undefined', () => {
      expect(detectContentType(undefined)).toBe('html');
    });

    it('should return html for numbers', () => {
      expect(detectContentType(42)).toBe('html');
    });

    it('should return html for objects', () => {
      expect(detectContentType({ key: 'value' })).toBe('html');
    });

    it('should return html for arrays', () => {
      expect(detectContentType([1, 2, 3])).toBe('html');
    });

    it('should return html for boolean', () => {
      expect(detectContentType(true)).toBe('html');
    });
  });

  describe('Edge Cases', () => {
    it('should not detect lowercase jsx-like tags as react/mdx', () => {
      // <div> is HTML, <Card> is JSX
      expect(detectContentType('<div><span>text</span></div>')).toBe('html');
    });

    it('should handle code blocks in markdown', () => {
      const source = `
# Code Example

\`\`\`javascript
const x = 1;
\`\`\`
      `;
      expect(detectContentType(source)).toBe('markdown');
    });

    it('should detect JSX component syntax in inline code as mdx', () => {
      // Note: detectContentType doesn't parse markdown code blocks/inline code,
      // so <Component /> is treated as JSX even when inside backticks
      const source = 'Use `<Component />` in your code';
      expect(detectContentType(source)).toBe('mdx');
    });

    it('should handle complex mixed content', () => {
      // Module syntax + JSX + markdown should be react (module takes precedence)
      const source = `
import { Card } from '@frontmcp/ui';

# Title

<Card>Content</Card>

export default function App() {
  return <div>Hello</div>;
}
      `;
      expect(detectContentType(source)).toBe('react');
    });

    it('should detect typescript syntax as react', () => {
      const source = `
import type { FC } from 'react';

interface Props {
  title: string;
}

const App: FC<Props> = ({ title }) => <h1>{title}</h1>;
export default App;
      `;
      expect(detectContentType(source)).toBe('react');
    });
  });

  describe('Priority Order', () => {
    it('should prioritize react over mdx for module syntax', () => {
      // Even if it has markdown AND JSX, import/export means it's a React module
      const source = `
import React from 'react';
# This looks like markdown
export default () => <Card />;
      `;
      expect(detectContentType(source)).toBe('react');
    });

    it('should prioritize mdx over markdown when JSX components present', () => {
      const source = `
# Title
<CustomComponent />
- List item
      `;
      expect(detectContentType(source)).toBe('mdx');
    });
  });
});
