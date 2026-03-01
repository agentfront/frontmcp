/**
 * PDF Renderer Tests
 */

import { PdfRenderer } from '../pdf';

describe('PdfRenderer', () => {
  const renderer = new PdfRenderer();

  describe('canHandle()', () => {
    it('should handle %PDF- header', () => {
      expect(renderer.canHandle('%PDF-1.4 ...')).toBe(true);
    });

    it('should handle base64 PDF', () => {
      expect(renderer.canHandle('JVBERi0xLjQK...')).toBe(true);
    });

    it('should handle PDF data URI', () => {
      expect(renderer.canHandle('data:application/pdf;base64,JVBERi0=')).toBe(true);
    });

    it('should not handle non-PDF content', () => {
      expect(renderer.canHandle('hello world')).toBe(false);
      expect(renderer.canHandle('<div>HTML</div>')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element for base64 PDF', () => {
      const element = renderer.render('JVBERi0xLjQK');
      expect(element).toBeTruthy();
    });

    it('should return a React element for data URI', () => {
      const element = renderer.render('data:application/pdf;base64,JVBERi0=');
      expect(element).toBeTruthy();
    });

    it('should use default className', () => {
      const element = renderer.render('JVBERi0xLjQK');
      expect(element.props.className).toBe('fmcp-pdf-content');
    });

    it('should use custom className', () => {
      const element = renderer.render('JVBERi0xLjQK', { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });

    it('should use toolName as title', () => {
      const element = renderer.render('JVBERi0xLjQK', { toolName: 'report' });
      expect(element.props.title).toBe('report');
    });

    it('should use default title', () => {
      const element = renderer.render('JVBERi0xLjQK');
      expect(element.props.title).toBe('PDF Document');
    });
  });

  describe('metadata', () => {
    it('should have type "pdf"', () => {
      expect(renderer.type).toBe('pdf');
    });

    it('should have priority 90', () => {
      expect(renderer.priority).toBe(90);
    });
  });
});
