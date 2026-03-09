/**
 * Image Renderer Tests
 */

import { ImageRenderer, isImage } from '../image';

describe('ImageRenderer', () => {
  const renderer = new ImageRenderer();

  describe('isImage()', () => {
    it('should detect PNG data URIs', () => {
      expect(isImage('data:image/png;base64,iVBOR...')).toBe(true);
    });

    it('should detect JPEG data URIs', () => {
      expect(isImage('data:image/jpeg;base64,/9j...')).toBe(true);
    });

    it('should detect GIF data URIs', () => {
      expect(isImage('data:image/gif;base64,R0lGOD...')).toBe(true);
    });

    it('should detect WebP data URIs', () => {
      expect(isImage('data:image/webp;base64,UklGR...')).toBe(true);
    });

    it('should detect SVG data URIs', () => {
      expect(isImage('data:image/svg+xml;base64,PHN2...')).toBe(true);
    });

    it('should detect PNG URLs', () => {
      expect(isImage('https://example.com/image.png')).toBe(true);
    });

    it('should detect JPEG URLs', () => {
      expect(isImage('https://example.com/photo.jpg')).toBe(true);
      expect(isImage('https://example.com/photo.jpeg')).toBe(true);
    });

    it('should detect GIF URLs', () => {
      expect(isImage('https://example.com/anim.gif')).toBe(true);
    });

    it('should detect WebP URLs', () => {
      expect(isImage('https://example.com/image.webp')).toBe(true);
    });

    it('should detect SVG URLs', () => {
      expect(isImage('https://example.com/icon.svg')).toBe(true);
    });

    it('should detect URLs with query params', () => {
      expect(isImage('https://example.com/image.png?w=200&h=100')).toBe(true);
    });

    it('should not detect non-image content', () => {
      expect(isImage('hello world')).toBe(false);
      expect(isImage('<div>HTML</div>')).toBe(false);
      expect(isImage('https://example.com/page')).toBe(false);
      expect(isImage('data:text/plain;base64,...')).toBe(false);
    });
  });

  describe('canHandle()', () => {
    it('should handle image URLs', () => {
      expect(renderer.canHandle('https://example.com/photo.jpg')).toBe(true);
    });

    it('should not handle non-image content', () => {
      expect(renderer.canHandle('hello world')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element', () => {
      const element = renderer.render('https://example.com/photo.jpg');
      expect(element).toBeTruthy();
      expect(element.type).toBeTruthy();
    });

    it('should use provided className', () => {
      const element = renderer.render('https://example.com/photo.jpg', { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });

    it('should use default className', () => {
      const element = renderer.render('https://example.com/photo.jpg');
      expect(element.props.className).toBe('fmcp-image-content');
    });
  });

  describe('metadata', () => {
    it('should have type "image"', () => {
      expect(renderer.type).toBe('image');
    });

    it('should have priority 30', () => {
      expect(renderer.priority).toBe(30);
    });
  });
});
