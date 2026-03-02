/**
 * Math Renderer Tests
 */

import { MathRenderer, isMath } from '../math';

describe('MathRenderer', () => {
  const renderer = new MathRenderer();

  describe('isMath()', () => {
    it('should detect display math $$...$$', () => {
      expect(isMath('$$E = mc^2$$')).toBe(true);
    });

    it('should detect inline math $...$', () => {
      expect(isMath('$x + y = z$')).toBe(true);
    });

    it('should detect bracket display math', () => {
      expect(isMath('\\[\\frac{1}{2}\\]')).toBe(true);
    });

    it('should detect paren inline math', () => {
      expect(isMath('\\(x^2\\)')).toBe(true);
    });

    it('should detect \\begin{equation}', () => {
      expect(isMath('\\begin{equation}x = 1\\end{equation}')).toBe(true);
    });

    it('should detect \\begin{align}', () => {
      expect(isMath('\\begin{align}a &= b\\end{align}')).toBe(true);
    });

    it('should detect \\begin{matrix}', () => {
      expect(isMath('\\begin{matrix}1 & 2\\end{matrix}')).toBe(true);
    });

    it('should not detect plain text', () => {
      expect(isMath('hello world')).toBe(false);
    });

    it('should not detect HTML', () => {
      expect(isMath('<div>not math</div>')).toBe(false);
    });

    it('should not detect text with dollar signs in context', () => {
      expect(isMath('The price is $100')).toBe(false);
    });
  });

  describe('canHandle()', () => {
    it('should handle display math', () => {
      expect(renderer.canHandle('$$\\int_0^1 x dx$$')).toBe(true);
    });

    it('should not handle plain text', () => {
      expect(renderer.canHandle('hello')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element', () => {
      const element = renderer.render('$$E = mc^2$$');
      expect(element).toBeTruthy();
    });

    it('should use default className', () => {
      const element = renderer.render('$$x$$');
      expect(element.props.className).toBe('fmcp-math-content');
    });

    it('should use custom className', () => {
      const element = renderer.render('$$x$$', { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });
  });

  describe('metadata', () => {
    it('should have type "math"', () => {
      expect(renderer.type).toBe('math');
    });

    it('should have priority 40', () => {
      expect(renderer.priority).toBe(40);
    });
  });
});
