/**
 * Weather UI Component
 *
 * React component for rendering weather data in Tool UI.
 * This component is used with the React renderer for SSR to HTML.
 */

import React from 'react';
import type { ToolUIProps } from '@frontmcp/ui';

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

// Weather output type
interface WeatherOutput {
  location: string;
  temperature: number;
  units: 'celsius' | 'fahrenheit';
  conditions: string;
  humidity: number;
  windSpeed: number;
  icon: string;
}

interface WeatherUIProps extends ToolUIProps<unknown, WeatherOutput> {}

/**
 * WeatherCard - Main weather display component
 *
 * This React component renders the weather data in a card layout.
 * When used with the React renderer, it's server-rendered to HTML.
 */
export function WeatherCard({ output, helpers }: WeatherUIProps) {
  const tempSymbol = output.units === 'celsius' ? '°C' : '°F';
  const weatherIcon = iconMap[output.icon] || '🌤️';

  // Determine badge variant based on conditions
  const getBadgeClass = () => {
    switch (output.conditions) {
      case 'sunny':
        return 'bg-green-100 text-green-800';
      case 'rainy':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="max-w-sm mx-auto bg-white dark:bg-black rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r  from-green-500 to-green-600  dark:from-green-600/40 dark:to-green-700/40 px-6 py-4">
        <h2 className="text-xl font-semibold text-white">{helpers.escapeHtml(output.location)}</h2>
        <p className="text-green-700 dark:text-green-400 text-sm">Current Weather</p>
      </div>

      {/* Temperature Display */}
      <div className="text-center py-8 px-6">
        <div className="text-6xl mb-4">{weatherIcon}</div>
        <div className="text-5xl font-light text-gray-800 dark:text-white mb-3">
          {output.temperature}
          {tempSymbol}
        </div>
        <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getBadgeClass()}`}>
          {helpers.escapeHtml(output.conditions)}
        </span>
      </div>

      {/* Weather Details */}
      <div className="border-t border-gray-200 dark:border-gray-600 px-6 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-200 text-sm">Humidity</div>
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">{output.humidity}%</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-200 text-sm">Wind Speed</div>
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">{output.windSpeed} km/h</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gray-50 dark:bg-gray-900 px-6 py-3 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-100">Powered by FrontMCP React UI</p>
      </div>
    </div>
  );
}

export default WeatherCard;
