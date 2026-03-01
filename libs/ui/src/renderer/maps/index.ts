import React, { useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { createLazyImport, runtimeImportWithFallback, esmShUrl } from '../common/lazy-import';
import { injectStylesheet } from '../common/inject-stylesheet';
import { useLazyModule } from '../common/use-lazy-module';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Constants
// ============================================

const LEAFLET_CSS_URL = 'https://esm.sh/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_CSS_ID = 'fmcp-leaflet-css';
const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// ============================================
// Types
// ============================================

export interface MapMarker {
  position: [number, number];
  popup?: string;
}

export interface MapConfig {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  geojson?: Record<string, unknown>;
  tileLayer?: { url: string; attribution?: string };
  title?: string;
  height?: number;
}

// ============================================
// Detection
// ============================================

const GEOJSON_PATTERN =
  /^\s*\{[\s\S]*"type"\s*:\s*"(?:FeatureCollection|Feature|Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon|GeometryCollection)"/;

export function isMap(content: string): boolean {
  const trimmed = content.trim();
  if (GEOJSON_PATTERN.test(trimmed)) return true;

  // Also detect map config JSON with center/markers
  try {
    const parsed = JSON.parse(trimmed);
    return !!(
      (parsed.center && Array.isArray(parsed.center)) ||
      (parsed.markers && Array.isArray(parsed.markers)) ||
      (parsed.geojson && typeof parsed.geojson === 'object')
    );
  } catch {
    return false;
  }
}

// ============================================
// Lazy Imports
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ReactLeafletModule {
  MapContainer: React.ComponentType<any>;
  TileLayer: React.ComponentType<any>;
  Marker: React.ComponentType<any>;
  Popup: React.ComponentType<any>;
  GeoJSON: React.ComponentType<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const lazyReactLeaflet = createLazyImport<ReactLeafletModule>('react-leaflet', async () => {
  const mod = await runtimeImportWithFallback('react-leaflet', esmShUrl('react-leaflet@5'));
  return mod as unknown as ReactLeafletModule;
});

// ============================================
// Styled Components
// ============================================

const MapRoot = styled(Box, {
  name: 'FrontMcpMap',
  slot: 'Root',
})(({ theme }) => ({
  width: '100%',
  borderRadius: theme.shape.borderRadius,
  overflow: 'hidden',
  border: `1px solid ${theme.palette.divider}`,
}));

// ============================================
// Helpers
// ============================================

function parseMapConfig(content: string): MapConfig {
  const parsed = JSON.parse(content);

  // If it's a GeoJSON object, wrap it
  if (
    parsed.type &&
    [
      'FeatureCollection',
      'Feature',
      'Point',
      'LineString',
      'Polygon',
      'MultiPoint',
      'MultiLineString',
      'MultiPolygon',
      'GeometryCollection',
    ].includes(parsed.type)
  ) {
    return {
      center: [0, 0],
      zoom: 2,
      geojson: parsed,
    };
  }

  return parsed as MapConfig;
}

// ============================================
// Component
// ============================================

interface MapViewProps {
  config: MapConfig;
  className?: string;
}

function MapView({ config, className }: MapViewProps): React.ReactElement {
  useEffect(() => {
    injectStylesheet(LEAFLET_CSS_URL, LEAFLET_CSS_ID);
  }, []);

  const leaflet = useLazyModule(lazyReactLeaflet);
  const height = config.height ?? 400;
  const center = config.center ?? [51.505, -0.09]; // Default: London
  const zoom = config.zoom ?? 13;

  if (!leaflet) {
    return React.createElement(Alert, { severity: 'info' }, 'Loading map library...');
  }

  const { MapContainer, TileLayer, Marker, Popup, GeoJSON } = leaflet;
  const tileUrl = config.tileLayer?.url ?? DEFAULT_TILE_URL;
  const attribution = config.tileLayer?.attribution ?? DEFAULT_ATTRIBUTION;

  return React.createElement(
    MapRoot,
    { className },
    config.title &&
      React.createElement(
        Typography,
        { variant: 'subtitle1', fontWeight: 600, sx: { p: 1.5, borderBottom: 1, borderColor: 'divider' } },
        config.title,
      ),
    React.createElement(
      MapContainer,
      {
        center: center as [number, number],
        zoom,
        style: { height, width: '100%' },
        scrollWheelZoom: true,
      },
      React.createElement(TileLayer, { url: tileUrl, attribution }),
      config.markers?.map((marker, i) =>
        React.createElement(
          Marker,
          { key: i, position: marker.position },
          marker.popup &&
            React.createElement(Popup, null, React.createElement(Paper, { elevation: 0, sx: { p: 1 } }, marker.popup)),
        ),
      ),
      config.geojson && React.createElement(GeoJSON, { data: config.geojson }),
    ),
  );
}

// Eagerly start loading react-leaflet
lazyReactLeaflet.load().catch(() => {
  /* optional dep */
});

// ============================================
// Renderer
// ============================================

export class MapsRenderer implements ContentRenderer {
  readonly type = 'map';
  readonly priority = 60;

  canHandle(content: string): boolean {
    return isMap(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    try {
      const config = parseMapConfig(content);
      return React.createElement(MapView, {
        config,
        className: options?.className ?? 'fmcp-map-content',
      });
    } catch {
      return React.createElement(Alert, { severity: 'error' }, 'Invalid map/GeoJSON data');
    }
  }
}

export const mapsRenderer = new MapsRenderer();
