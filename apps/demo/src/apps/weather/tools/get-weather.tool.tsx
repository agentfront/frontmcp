/**
 * Get Weather Tool
 *
 * Demonstrates how to use Tool UI templates with @frontmcp/sdk.
 * This tool returns weather data with a rich React widget using
 * @frontmcp/ui components for display in OpenAI Apps SDK, ext-apps,
 * and other UI-capable hosts.
 */

import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

// Define input/output schemas
const inputSchema = {
  location: z.string().describe('City name or location'),
  units: z.enum(['celsius', 'fahrenheit']).nullish().describe('Temperature units'),
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
export type WeatherInput = z.infer<z.ZodObject<typeof inputSchema>>;
export type WeatherOutput = z.infer<typeof outputSchema>;

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
    widgetDescription: 'Displays current weather conditions with temperature, humidity, and wind speed.',
    displayMode: 'inline',
    servingMode: 'static',
    uiType: 'react',
    template: { file: 'apps/demo/src/apps/weather/tools/get-weather.ui.tsx' },
  },
  codecall: {
    visibleInListTools: true,
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
