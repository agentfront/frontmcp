import type { WeatherInput, WeatherOutput } from './get-weather.tool';
import { Badge, Card } from './get-weather.ui-2';
import { useCallTool, useStructuredContent } from '@frontmcp/ui/react';

const iconMap: Record<string, string> = {
  sunny: '☀️',
  cloudy: '☁️',
  rainy: '🌧️',
  snowy: '❄️',
  stormy: '⛈️',
  windy: '💨',
  foggy: '🌫️',
};

export default function WeatherWidget(props: { loading?: boolean }) {
  const { loading } = props;
  let output = useStructuredContent<WeatherOutput>();
  const [getWeather, state, reset] = useCallTool<WeatherInput, WeatherOutput>('get_weather');

  if (state.data?.structuredContent) {
    output = state.data.structuredContent as WeatherOutput;
  }

  if (state.loading || loading) {
    return (
      <Card title="Weather" subtitle="Loading...">
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>{'🌤️'}</div>
          <div>Fetching weather data...</div>
        </div>
      </Card>
    );
  }

  if (!output) {
    return (
      <Card title="Weather" subtitle="No Data">
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>{'🌤️'}</div>
          <div>No weather data available.</div>
        </div>
      </Card>
    );
  }

  const tempSymbol = output.units === 'celsius' ? '°C' : '°F';
  const weatherIcon = iconMap[output.icon] || '🌤️';
  const badgeVariant = output.conditions === 'sunny' ? 'success' : output.conditions === 'rainy' ? 'info' : 'default';

  return (
    <Card title={output.location} subtitle="Current Weather" elevation={2}>
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <button onClick={() => getWeather({ location: output.location })}>Refresh Weather</button>
        <div style={{ fontSize: '3.75rem', marginBottom: '8px' }}>{weatherIcon}</div>
        <div style={{ fontSize: '3rem', fontWeight: 300, marginBottom: '8px' }}>
          {output.temperature}
          {tempSymbol}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Badge label={output.conditions} variant={badgeVariant} />
        </div>
      </div>
      <div style={{ marginTop: '16px' }}>
        <div>Humidity: {output.humidity}%</div>
        <div>Wind Speed: {output.windSpeed} km/h</div>
        <div>Units: {output.units === 'celsius' ? 'Celsius' : 'Fahrenheit'}</div>
      </div>
    </Card>
  );
}
