/**
 * Get Weather Tool
 *
 * Demonstrates how to use Tool UI templates with @frontmcp/sdk.
 * This tool returns weather data with a rich HTML widget using
 * @frontmcp/ui components for display in OpenAI Apps SDK, ext-apps,
 * and other UI-capable hosts.
 */

import { Tool, ToolContext } from '@frontmcp/sdk';
import { card, descriptionList, badge } from '@frontmcp/ui';
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

// Weather condition icon mapping (using emoji for simplicity)
const iconMap: Record<string, string> = {
  sunny: '☀️',
  cloudy: '☁️',
  rainy: '🌧️',
  snowy: '❄️',
  stormy: '⛈️',
  windy: '💨',
  foggy: '🌫️',
};

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
    template: (ctx) => {
      // ctx.input and ctx.output are typed from inputSchema and outputSchema
      const { output, helpers } = ctx;
      const tempSymbol = output.units === 'celsius' ? '°C' : '°F';
      const weatherIcon = iconMap[output.icon] || '🌤️';

      // Build weather details using @frontmcp/ui descriptionList component
      const weatherDetails = descriptionList(
        [
          { term: 'Humidity', description: `${output.humidity}%` },
          { term: 'Wind Speed', description: `${output.windSpeed} km/h` },
          { term: 'Units', description: output.units === 'celsius' ? 'Celsius' : 'Fahrenheit' },
        ],
        { layout: 'grid', className: 'mt-4' },
      );

      // Build condition badge
      const conditionBadge = badge(helpers.escapeHtml(output.conditions), {
        variant: output.conditions === 'sunny' ? 'success' : output.conditions === 'rainy' ? 'info' : 'secondary',
        size: 'md',
      });

      // Main temperature display
      const temperatureDisplay = `
        <div class="text-center py-6">
          <div class="text-6xl mb-2">${weatherIcon}</div>
          <div class="text-5xl font-light text-text-primary mb-2">
            ${output.temperature}${tempSymbol}
          </div>
          <div class="flex justify-center">
            ${conditionBadge}
          </div>
        </div>
      `;

      // Wrap in card component from @frontmcp/ui
      return card(temperatureDisplay + weatherDetails, {
        title: helpers.escapeHtml(output.location),
        subtitle: 'Current Weather',
        variant: 'elevated',
        size: 'md',
        className: 'p-4 max-w-sm mx-auto',
      });
    },
    widgetDescription: 'Displays current weather conditions with temperature, humidity, and wind speed.',
    displayMode: 'inline',
    baseTemplate: 'weather-card-template',
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
    let temperature = weatherData.temperature!;

    // Convert to Fahrenheit if requested
    if (units === 'fahrenheit') {
      temperature = Math.round((temperature * 9) / 5 + 32);
    }

    return {
      location: input.location,
      temperature,
      units,
      conditions: weatherData.conditions!,
      humidity: weatherData.humidity!,
      windSpeed: weatherData.windSpeed!,
      icon: weatherData.icon!,
    };
  }
}
