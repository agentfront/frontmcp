/**
 * Get Weather Tool with MDX UI
 *
 * Demonstrates how to use MDX (Markdown + JSX) for Tool UI templates.
 * The UI is defined as an MDX string and rendered via the MDX renderer.
 */

import React from 'react';
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

// Define input/output schemas
const inputSchema = {
  location: z.string().describe('City name or location'),
  units: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature units'),
};

const outputSchema = z.object({
  location: z.string(),
  temperature: z.number(),
  units: z.enum(['celsius', 'fahrenheit']),
  conditions: z.string(),
  humidity: z.number(),
  windSpeed: z.number(),
  icon: z.string(),
});

// Infer types from schemas for proper typing
type WeatherInput = z.infer<z.ZodObject<typeof inputSchema>>;
type WeatherOutput = z.infer<typeof outputSchema>;

// Weather icon mapping (using emoji for simplicity)
const iconMap: Record<string, string> = {
  sunny: '☀️',
  cloudy: '☁️',
  rainy: '🌧️',
  snowy: '❄️',
  stormy: '⛈️',
  windy: '💨',
  foggy: '🌫️',
};

// Custom MDX Components for the weather tool
// These are React components that can be used in MDX templates

/**
 * Alert component for displaying notices in MDX
 */
const Alert = ({
  type = 'info',
  children,
}: {
  type?: 'info' | 'warning' | 'error' | 'success';
  children: React.ReactNode;
}) => {
  const colors: Record<string, string> = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    success: 'bg-green-50 border-green-200 text-green-800',
  };

  const icons: Record<string, string> = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
    success: '✅',
  };

  return (
    <div className={`p-4 rounded-lg border ${colors[type]} my-4`}>
      <span className="mr-2">{icons[type]}</span>
      {children}
    </div>
  );
};

/**
 * WeatherCard component for displaying weather summary
 */
const WeatherCard = ({ location, temperature, units }: { location: string; temperature: number; units: string }) => {
  const symbol = units === 'celsius' ? '°C' : '°F';
  return (
    <div className="bg-gradient-to-r from-blue-400 to-blue-600 text-white p-6 rounded-xl shadow-lg text-center">
      <h2 className="text-2xl font-bold">{location}</h2>
      <p className="text-5xl font-light mt-2">
        {temperature}
        {symbol}
      </p>
    </div>
  );
};

// MDX template as a string - automatically detected as MDX
const mdxTemplate = `
# Weather Report

<WeatherCard location={output.location} temperature={output.temperature} units={output.units} />

## Current Conditions

**{output.conditions}** with {output.humidity}% humidity

| Metric | Value |
|--------|-------|
| Temperature | {output.temperature}{output.units === 'celsius' ? '°C' : '°F'} |
| Humidity | {output.humidity}% |
| Wind Speed | {output.windSpeed} km/h |
| Conditions | {output.conditions} |

---

*Powered by FrontMCP MDX UI*
`;

// Alternative: Use a function that returns MDX
const mdxTemplateFunction = (ctx: { output: WeatherOutput; helpers: any }) => {
  const { output, helpers } = ctx;
  const tempSymbol = output.units === 'celsius' ? '°C' : '°F';
  const weatherIcon = iconMap[output.icon] || '🌤️';

  return `
# ${helpers.escapeHtml(output.location)} Weather

<div className="text-center py-4">
  <span className="text-6xl">${weatherIcon}</span>
</div>

## ${output.temperature}${tempSymbol}

**Conditions:** ${helpers.escapeHtml(output.conditions)}

### Details

- **Humidity:** ${output.humidity}%
- **Wind Speed:** ${output.windSpeed} km/h

---

<Alert type="info">
  Weather data is for demonstration purposes only.
</Alert>
`;
};

@Tool({
  name: 'get_weather_mdx',
  description:
    'Get current weather for a location with MDX UI. Returns temperature, conditions, humidity, and wind speed.',
  inputSchema,
  outputSchema,
  annotations: {
    title: 'Weather Lookup (MDX)',
    readOnlyHint: true,
    openWorldHint: true,
  },
  ui: {
    // Use MDX template function - auto-detected as MDX
    template: mdxTemplateFunction,
    widgetDescription: 'Displays current weather conditions using MDX (Markdown + JSX) template rendering.',
    displayMode: 'inline',
    // Pass custom MDX components - these will be available in the MDX template
    mdxComponents: { WeatherCard, Alert },
  },
})
export default class GetWeatherTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: WeatherInput): Promise<WeatherOutput> {
    // Mock weather data - in production, this would call a weather API
    const mockWeatherData: Record<string, Partial<WeatherOutput>> = {
      'san francisco': { temperature: 18, conditions: 'foggy', humidity: 75, windSpeed: 15, icon: 'foggy' },
      'new york': { temperature: 22, conditions: 'sunny', humidity: 55, windSpeed: 10, icon: 'sunny' },
      london: { temperature: 14, conditions: 'rainy', humidity: 80, windSpeed: 20, icon: 'rainy' },
      tokyo: { temperature: 25, conditions: 'cloudy', humidity: 65, windSpeed: 8, icon: 'cloudy' },
      sydney: { temperature: 28, conditions: 'sunny', humidity: 50, windSpeed: 12, icon: 'sunny' },
    };

    const locationLower = input.location.toLowerCase();
    const weatherData = mockWeatherData[locationLower] || {
      temperature: 20 + Math.floor(Math.random() * 15),
      conditions: 'partly cloudy',
      humidity: 50 + Math.floor(Math.random() * 30),
      windSpeed: 5 + Math.floor(Math.random() * 20),
      icon: 'cloudy',
    };

    const units = input.units || 'celsius';
    let temperature = weatherData.temperature ?? 20;

    // Convert to Fahrenheit if requested
    if (units === 'fahrenheit') {
      temperature = Math.round((temperature * 9) / 5 + 32);
    }

    return {
      location: input.location,
      temperature,
      units,
      conditions: weatherData.conditions ?? 'partly cloudy',
      humidity: weatherData.humidity ?? 50,
      windSpeed: weatherData.windSpeed ?? 10,
      icon: weatherData.icon ?? 'cloudy',
    };
  }
}
