/**
 * HTML Renderer Tests
 */

import { HtmlRenderer, escapeHtml } from '../html';

describe('HtmlRenderer', () => {
  const renderer = new HtmlRenderer();

  describe('canHandle()', () => {
    it('should handle basic HTML', () => {
      expect(renderer.canHandle('<div>Hello</div>')).toBe(true);
    });

    it('should handle complex HTML', () => {
      expect(renderer.canHandle('<table><tr><td>Cell</td></tr></table>')).toBe(true);
    });

    it('should handle HTML with whitespace prefix', () => {
      expect(renderer.canHandle('  <div>Hello</div>')).toBe(true);
    });

    it('should not handle non-HTML text', () => {
      expect(renderer.canHandle('just text')).toBe(false);
    });

    it('should not handle self-closing only tags', () => {
      expect(renderer.canHandle('<br />')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element', () => {
      const element = renderer.render('<div>Hello</div>');
      expect(element).toBeTruthy();
    });

    it('should use default className', () => {
      const element = renderer.render('<div>Hello</div>');
      expect(element.props.className).toBe('fmcp-html-content');
    });

    it('should use custom className', () => {
      const element = renderer.render('<div>Hello</div>', { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });
  });

  describe('sanitization', () => {
    it('should escape script tags', () => {
      const result = escapeHtml('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });

    it('should escape event handler attributes', () => {
      const result = escapeHtml('<div onclick="alert(1)">click</div>');
      expect(result).not.toContain('<div onclick');
      expect(result).toContain('&lt;div onclick');
    });

    it('should escape all dangerous characters', () => {
      const result = escapeHtml('a & b < c > d " e \' f');
      expect(result).toBe('a &amp; b &lt; c &gt; d &quot; e &#39; f');
    });
  });

  describe('metadata', () => {
    it('should have type "html"', () => {
      expect(renderer.type).toBe('html');
    });

    it('should have priority 0', () => {
      expect(renderer.priority).toBe(0);
    });
  });
});
