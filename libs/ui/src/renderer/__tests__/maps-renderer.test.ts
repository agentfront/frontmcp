/**
 * Maps Renderer Tests
 */

import { MapsRenderer, isMap } from '../maps';

describe('MapsRenderer', () => {
  const renderer = new MapsRenderer();

  const geojson = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-0.09, 51.505] },
        properties: { name: 'London' },
      },
    ],
  });

  const mapConfig = JSON.stringify({
    center: [51.505, -0.09],
    zoom: 13,
    markers: [{ position: [51.505, -0.09], popup: 'London' }],
  });

  describe('isMap()', () => {
    it('should detect FeatureCollection GeoJSON', () => {
      expect(isMap(geojson)).toBe(true);
    });

    it('should detect Feature GeoJSON', () => {
      const feature = JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {},
      });
      expect(isMap(feature)).toBe(true);
    });

    it('should detect Point GeoJSON', () => {
      const point = JSON.stringify({ type: 'Point', coordinates: [0, 0] });
      expect(isMap(point)).toBe(true);
    });

    it('should detect LineString GeoJSON', () => {
      const line = JSON.stringify({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      });
      expect(isMap(line)).toBe(true);
    });

    it('should detect Polygon GeoJSON', () => {
      const polygon = JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      });
      expect(isMap(polygon)).toBe(true);
    });

    it('should detect map config with center', () => {
      expect(isMap(mapConfig)).toBe(true);
    });

    it('should detect map config with markers', () => {
      expect(isMap(JSON.stringify({ markers: [{ position: [0, 0] }] }))).toBe(true);
    });

    it('should detect map config with geojson property', () => {
      expect(isMap(JSON.stringify({ geojson: { type: 'Point', coordinates: [0, 0] } }))).toBe(true);
    });

    it('should not detect non-map JSON', () => {
      expect(isMap(JSON.stringify({ type: 'bar', data: [] }))).toBe(false);
    });

    it('should not detect non-JSON text', () => {
      expect(isMap('hello world')).toBe(false);
    });
  });

  describe('canHandle()', () => {
    it('should handle GeoJSON', () => {
      expect(renderer.canHandle(geojson)).toBe(true);
    });

    it('should handle map config', () => {
      expect(renderer.canHandle(mapConfig)).toBe(true);
    });

    it('should not handle non-map', () => {
      expect(renderer.canHandle('hello')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element for GeoJSON', () => {
      const element = renderer.render(geojson);
      expect(element).toBeTruthy();
    });

    it('should return a React element for map config', () => {
      const element = renderer.render(mapConfig);
      expect(element).toBeTruthy();
    });

    it('should return error for invalid JSON', () => {
      const element = renderer.render('invalid json');
      expect(element).toBeTruthy();
      expect(element.props.severity).toBe('error');
    });

    it('should use default className', () => {
      const element = renderer.render(geojson);
      expect(element.props.className).toBe('fmcp-map-content');
    });

    it('should use custom className', () => {
      const element = renderer.render(geojson, { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });
  });

  describe('metadata', () => {
    it('should have type "map"', () => {
      expect(renderer.type).toBe('map');
    });

    it('should have priority 60', () => {
      expect(renderer.priority).toBe(60);
    });
  });
});
