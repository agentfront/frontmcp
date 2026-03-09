/**
 * MDX/Markdown Renderer Tests
 */

import { MdxRenderer } from '../mdx';

describe('MdxRenderer', () => {
  const renderer = new MdxRenderer();

  describe('canHandle()', () => {
    it('should handle frontmatter', () => {
      expect(renderer.canHandle('---\ntitle: Hello\n---\n# Heading')).toBe(true);
    });

    it('should handle import statements', () => {
      expect(renderer.canHandle('import React from "react"\n# Hello')).toBe(true);
    });

    it('should handle capitalized tags', () => {
      expect(renderer.canHandle('<Button>Click</Button>')).toBe(true);
    });

    it('should handle markdown headings', () => {
      expect(renderer.canHandle('# Hello World')).toBe(true);
      expect(renderer.canHandle('## Subheading')).toBe(true);
      expect(renderer.canHandle('### Third level')).toBe(true);
    });

    it('should handle bullet lists', () => {
      expect(renderer.canHandle('- Item 1\n- Item 2')).toBe(true);
      expect(renderer.canHandle('* Item 1\n* Item 2')).toBe(true);
    });

    it('should not handle plain HTML', () => {
      expect(renderer.canHandle('<div>Hello</div>')).toBe(false);
    });

    it('should not handle plain text', () => {
      expect(renderer.canHandle('just text')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element for markdown', () => {
      const element = renderer.render('# Hello\n\nSome text');
      expect(element).toBeTruthy();
    });

    it('should use default className', () => {
      const element = renderer.render('# Hello');
      expect(element.props.className).toBe('fmcp-mdx-content');
    });

    it('should use custom className', () => {
      const element = renderer.render('# Hello', { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });

    it('should render headings in fallback mode', () => {
      // react-markdown won't be loaded in test env, so fallback is used
      const element = renderer.render('# Title\n## Subtitle\n### Section');
      expect(element).toBeTruthy();
      expect(element.type).toBeTruthy();
    });

    it('should render list items in fallback mode', () => {
      const element = renderer.render('- Item 1\n- Item 2\n- Item 3');
      expect(element).toBeTruthy();
    });

    it('should render bold text in fallback mode', () => {
      const element = renderer.render('**Bold Text**');
      expect(element).toBeTruthy();
    });

    it('should render paragraphs in fallback mode', () => {
      const element = renderer.render('Hello world\n\nAnother paragraph');
      expect(element).toBeTruthy();
    });
  });

  describe('metadata', () => {
    it('should have type "mdx"', () => {
      expect(renderer.type).toBe('mdx');
    });

    it('should have priority 5', () => {
      expect(renderer.priority).toBe(5);
    });
  });
});
