import type { WeatherOutput } from './get-weather.tool';
import { Badge, Card } from './get-weather.ui-2';
import { useCallTool } from '@frontmcp/ui/react';

const iconMap: Record<string, string> = {
  sunny: '☀️',
  cloudy: '☁️',
  rainy: '🌧️',
  snowy: '❄️',
  stormy: '⛈️',
  windy: '💨',
  foggy: '🌫️',
};

export default function WeatherWidget(props: { output: WeatherOutput | null; loading?: boolean }) {
  const { output, loading } = props;
  console.log('WeatherWidget props:', props);
  const [getWeather, state, reset] = useCallTool('get_weather'); // Example call to fetch weather for SF

  console.log('WeatherWidget state:', state);

  if (loading || !output) {
    return (
      <Card title="Weather" subtitle="Loading...">
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>{'🌤️'}</div>
          <div>Fetching weather data...</div>
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
