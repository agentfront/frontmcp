/**
 * Get Weather Tool with React UI
 *
 * Demonstrates how to use React components for Tool UI templates.
 * The UI is defined as a React component and rendered via the React renderer.
 */

import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import WeatherCard from './weather-ui';

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

@Tool({
  name: 'get_weather',
  description: 'Get current weather for a location. Returns temperature, conditions, humidity, and wind speed.',
  inputSchema,
  outputSchema,
  annotations: {
    title: 'Weather Lookup',
    readOnlyHint: true,
    openWorldHint: true,
  },
  ui: {
    template: WeatherCard,
    widgetDescription: 'Displays current weather conditions with temperature, humidity, and wind speed.',
    displayMode: 'inline',
    widgetAccessible: true,
    servingMode: 'mcp-resource',
  },
})
export default class GetWeatherTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  // async execute(input: { location: string; units?: string }): Promise<WeatherOutput> {
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
