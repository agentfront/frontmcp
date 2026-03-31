/**
 * Weather Widget - React component for FileSource bundling.
 * This file contains ONLY browser-safe imports (React, @frontmcp/ui).
 * It is bundled by esbuild at server startup and served as inline HTML.
 */

import { Card, Badge } from '@frontmcp/ui/components';

const iconMap: Record<string, string> = {
  sunny: '\u2600\uFE0F',
  cloudy: '\u2601\uFE0F',
  rainy: '\uD83C\uDF27\uFE0F',
  snowy: '\u2744\uFE0F',
};

interface WeatherOutput {
  location: string;
  temperature: number;
  units: 'celsius' | 'fahrenheit';
  conditions: string;
  icon: string;
}

export default function WeatherWidget({ output, loading }: { output: WeatherOutput | null; loading?: boolean }) {
  if (loading || !output) {
    return (
      <Card title="Weather" subtitle="Loading...">
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#6b7280' }}>Fetching weather data...</div>
      </Card>
    );
  }

  const symbol = output.units === 'celsius' ? '\u00B0C' : '\u00B0F';
  const icon = iconMap[output.icon] || '\uD83C\uDF24\uFE0F';
  const variant = output.conditions === 'sunny' ? 'success' : 'default';

  return (
    <Card title={output.location} subtitle="Current Weather" elevation={2}>
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <div style={{ fontSize: '3rem' }}>{icon}</div>
        <div style={{ fontSize: '2rem', fontWeight: 300 }}>
          {output.temperature}
          {symbol}
        </div>
        <Badge label={output.conditions} variant={variant} />
      </div>
    </Card>
  );
}
