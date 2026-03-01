/**
 * HTML Renderer Tests
 */

import { HtmlRenderer } from '../html';

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

  describe('metadata', () => {
    it('should have type "html"', () => {
      expect(renderer.type).toBe('html');
    });

    it('should have priority 0', () => {
      expect(renderer.priority).toBe(0);
    });
  });
});
