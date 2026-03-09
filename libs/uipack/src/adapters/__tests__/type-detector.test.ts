/**
 * Type Detector Tests
 *
 * Tests for detectUIType().
 */

import { detectUIType } from '../type-detector';

describe('detectUIType', () => {
  it('should return "auto" for null', () => {
    expect(detectUIType(null)).toBe('auto');
  });

  it('should return "auto" for undefined', () => {
    expect(detectUIType(undefined)).toBe('auto');
  });

  it('should return "react" for FileSource with .tsx extension', () => {
    expect(detectUIType({ file: 'widget.tsx' })).toBe('react');
  });

  it('should return "react" for FileSource with .jsx extension', () => {
    expect(detectUIType({ file: 'widget.jsx' })).toBe('react');
  });

  it('should return "react" for FileSource with .TSX extension (case-insensitive)', () => {
    expect(detectUIType({ file: 'widget.TSX' })).toBe('react');
  });

  it('should return "auto" for FileSource with .html extension', () => {
    expect(detectUIType({ file: 'widget.html' })).toBe('auto');
  });

  it('should return "react" for class component (prototype.render)', () => {
    function MyComponent() {
      /* noop */
    }
    MyComponent.prototype.render = function () {
      return 'html';
    };
    expect(detectUIType(MyComponent)).toBe('react');
  });

  it('should return "react" for memo/forwardRef component ($$typeof)', () => {
    const memoComponent = Object.assign(() => 'html', {
      $$typeof: Symbol.for('react.memo'),
    });
    expect(detectUIType(memoComponent)).toBe('react');
  });

  it('should return "html" for a regular function', () => {
    const fn = () => '<div>Hello</div>';
    expect(detectUIType(fn)).toBe('html');
  });

  it('should return "html" for string containing HTML tags', () => {
    expect(detectUIType('<div>Hello</div>')).toBe('html');
  });

  it('should return "markdown" for string without HTML tags', () => {
    expect(detectUIType('# Hello World\n\nSome text')).toBe('markdown');
  });

  it('should return "auto" for unknown object types', () => {
    expect(detectUIType({ unknown: true })).toBe('auto');
  });

  it('should return "auto" for number', () => {
    expect(detectUIType(42)).toBe('auto');
  });
});
