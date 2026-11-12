/**
 * MDX/Markdown Renderer: raw HTML with react-markdown and rehype-raw loaded
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

interface HastNode {
  type: string;
  value?: string;
  children?: HastNode[];
}

type RehypePlugin = () => (tree: HastNode) => void;
type Override = (props: Record<string, unknown>) => React.ReactElement;

interface FakeReactMarkdownProps {
  children: string;
  rehypePlugins: RehypePlugin[];
  components: Record<string, Override>;
}

const mockRawHtmlParsed: string[] = [];

jest.mock('../common/lazy-import', () => ({
  ...jest.requireActual('../common/lazy-import'),
  runtimeImportWithFallback: async (specifier: string) => {
    if (specifier === 'react-markdown') {
      // Runs the rehype plugins over the document as one raw HTML node, then renders the overrides
      // with the props that HTML attributes give them
      const ReactMarkdown = ({ children, rehypePlugins, components }: FakeReactMarkdownProps) => {
        const tree: HastNode = { type: 'root', children: [{ type: 'raw', value: children }] };
        for (const plugin of rehypePlugins) plugin()(tree);
        return React.createElement(
          'div',
          null,
          components['p']({ component: 'meta', httpEquiv: 'refresh', content: '0;url=https://example.com' }),
          components['pre']({ as: 'base', href: 'https://example.com/', children: 'code' }),
        );
      };
      return { default: ReactMarkdown };
    }
    if (specifier === 'rehype-raw') {
      const rehypeRaw: RehypePlugin = () => (tree) => {
        for (const node of tree.children ?? []) mockRawHtmlParsed.push(node.value ?? '');
      };
      return { default: rehypeRaw };
    }
    throw new Error(`${specifier} is not installed`);
  },
}));

describe('MdxRenderer with react-markdown and rehype-raw', () => {
  let markup = '';

  beforeAll(async () => {
    const { MdxRenderer } = await import('../mdx');
    // Let the eager loads of the optional modules settle
    await new Promise((resolve) => setImmediate(resolve));
    markup = renderToStaticMarkup(
      new MdxRenderer().render(
        '<b>Bold</b><img src="x" onerror="alert(1)"><iframe srcdoc="<script>alert(1)</script>"></iframe>',
      ),
    );
  });

  it('sanitizes the raw HTML of the document before rehype-raw parses it', () => {
    expect(mockRawHtmlParsed).toEqual(['<b>Bold</b><img src="x"><iframe></iframe>']);
  });

  it('does not let a component or as attribute choose the element MUI renders', () => {
    expect(markup).toContain('<p');
    expect(markup).toContain('<pre');
    expect(markup).not.toContain('<meta');
    expect(markup).not.toContain('<base');
  });
});
