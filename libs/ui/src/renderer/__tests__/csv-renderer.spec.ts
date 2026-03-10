/**
 * CSV Renderer Tests
 */

import { CsvRenderer, detectDelimiter, parseCsv } from '../csv';

describe('CsvRenderer', () => {
  const renderer = new CsvRenderer();

  describe('detectDelimiter()', () => {
    it('should detect comma delimiter', () => {
      expect(detectDelimiter('name,age,city\nAlice,30,NYC')).toBe(',');
    });

    it('should detect tab delimiter', () => {
      expect(detectDelimiter('name\tage\tcity\nAlice\t30\tNYC')).toBe('\t');
    });

    it('should detect semicolon delimiter', () => {
      expect(detectDelimiter('name;age;city\nAlice;30;NYC')).toBe(';');
    });

    it('should default to comma when ambiguous', () => {
      expect(detectDelimiter('single line')).toBe(',');
    });
  });

  describe('parseCsv()', () => {
    it('should parse comma-separated CSV', () => {
      const result = parseCsv('name,age\nAlice,30\nBob,25', ',');
      expect(result).toEqual([
        ['name', 'age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
    });

    it('should trim cell values', () => {
      const result = parseCsv('name , age \n Alice , 30 ', ',');
      expect(result).toEqual([
        ['name', 'age'],
        ['Alice', '30'],
      ]);
    });

    it('should parse tab-separated values', () => {
      const result = parseCsv('name\tage\nAlice\t30', '\t');
      expect(result).toEqual([
        ['name', 'age'],
        ['Alice', '30'],
      ]);
    });
  });

  describe('canHandle()', () => {
    it('should handle comma CSV', () => {
      expect(renderer.canHandle('name,age,city\nAlice,30,NYC\nBob,25,LA')).toBe(true);
    });

    it('should handle tab CSV', () => {
      expect(renderer.canHandle('name\tage\tcity\nAlice\t30\tNYC\nBob\t25\tLA')).toBe(true);
    });

    it('should handle semicolon CSV', () => {
      expect(renderer.canHandle('name;age;city\nAlice;30;NYC\nBob;25;LA')).toBe(true);
    });

    it('should not handle single line', () => {
      expect(renderer.canHandle('just one line')).toBe(false);
    });

    it('should not handle inconsistent columns', () => {
      expect(renderer.canHandle('a,b,c\nx,y')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element', () => {
      const element = renderer.render('name,age\nAlice,30\nBob,25');
      expect(element).toBeTruthy();
    });

    it('should use default className', () => {
      const element = renderer.render('name,age\nAlice,30');
      expect(element.props.className).toBe('fmcp-csv-table');
    });

    it('should use custom className', () => {
      const element = renderer.render('name,age\nAlice,30', { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });

    it('should accept rendererOptions pageSize', () => {
      const element = renderer.render('name,age\nAlice,30', {
        rendererOptions: { pageSize: 10 },
      });
      expect(element).toBeTruthy();
    });
  });

  describe('metadata', () => {
    it('should have type "csv"', () => {
      expect(renderer.type).toBe('csv');
    });

    it('should have priority 10', () => {
      expect(renderer.priority).toBe(10);
    });
  });
});
