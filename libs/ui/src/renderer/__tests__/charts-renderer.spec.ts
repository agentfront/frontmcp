/**
 * Charts Renderer Tests
 */

import { ChartsRenderer, isChart } from '../charts';

describe('ChartsRenderer', () => {
  const renderer = new ChartsRenderer();

  const validChart = JSON.stringify({
    type: 'bar',
    data: [
      { name: 'A', value: 10 },
      { name: 'B', value: 20 },
    ],
  });

  describe('isChart()', () => {
    it('should detect bar chart JSON', () => {
      expect(isChart(JSON.stringify({ type: 'bar', data: [] }))).toBe(true);
    });

    it('should detect line chart JSON', () => {
      expect(isChart(JSON.stringify({ type: 'line', data: [] }))).toBe(true);
    });

    it('should detect area chart JSON', () => {
      expect(isChart(JSON.stringify({ type: 'area', data: [] }))).toBe(true);
    });

    it('should detect pie chart JSON', () => {
      expect(isChart(JSON.stringify({ type: 'pie', data: [] }))).toBe(true);
    });

    it('should detect scatter chart JSON', () => {
      expect(isChart(JSON.stringify({ type: 'scatter', data: [] }))).toBe(true);
    });

    it('should detect radar chart JSON', () => {
      expect(isChart(JSON.stringify({ type: 'radar', data: [] }))).toBe(true);
    });

    it('should detect composed chart JSON', () => {
      expect(isChart(JSON.stringify({ type: 'composed', data: [] }))).toBe(true);
    });

    it('should not detect unknown chart type', () => {
      expect(isChart(JSON.stringify({ type: 'unknown', data: [] }))).toBe(false);
    });

    it('should not detect non-JSON content', () => {
      expect(isChart('hello world')).toBe(false);
    });

    it('should not detect JSON without data field', () => {
      expect(isChart(JSON.stringify({ type: 'bar' }))).toBe(false);
    });
  });

  describe('canHandle()', () => {
    it('should handle valid chart JSON', () => {
      expect(renderer.canHandle(validChart)).toBe(true);
    });

    it('should not handle non-chart content', () => {
      expect(renderer.canHandle('hello')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element for valid JSON', () => {
      const element = renderer.render(validChart);
      expect(element).toBeTruthy();
    });

    it('should return an error alert for invalid JSON', () => {
      const element = renderer.render('not valid json');
      expect(element).toBeTruthy();
      // Should be an Alert component
      expect(element.props.severity).toBe('error');
    });

    it('should use default className for valid JSON', () => {
      const element = renderer.render(validChart);
      expect(element.props.className).toBe('fmcp-chart-content');
    });

    it('should use custom className', () => {
      const element = renderer.render(validChart, { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });
  });

  describe('metadata', () => {
    it('should have type "chart"', () => {
      expect(renderer.type).toBe('chart');
    });

    it('should have priority 80', () => {
      expect(renderer.priority).toBe(80);
    });
  });
});
