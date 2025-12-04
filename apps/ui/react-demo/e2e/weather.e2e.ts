/**
 * @file weather.e2e.spec.ts
 * @description E2E tests for React Weather Tool UI
 *
 * Tests verify that the React component template is properly rendered
 * and tool output data is correctly bound to the HTML.
 */

import { test, expect, UIAssertions } from '@frontmcp/testing';

// Weather output type for proper typing
interface WeatherOutput {
  location: string;
  temperature: number;
  units: 'celsius' | 'fahrenheit';
  conditions: string;
  humidity: number;
  windSpeed: number;
  icon: string;
}

// Configure test to use the React demo server
// The fixture will auto-start the server from the entry file
test.use({
  server: './src/main.ts',
  port: 3003,
  transport: 'streamable-http',
  publicMode: true,
});

test.describe('React Weather Tool UI', () => {
  test('renders weather UI with correct data binding', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather', { location: 'London' });

    // Basic assertions
    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml();
    expect(result).toBeXssSafe();

    // Verify data binding - output values appear in HTML
    const output = result.json<WeatherOutput>();
    expect(result).toContainBoundValue(output.location);
    expect(result).toContainBoundValue(output.temperature);
    expect(result).toContainBoundValue(output.conditions);
  });

  test('has proper HTML structure (not raw text)', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather', { location: 'Tokyo' });

    expect(result).toHaveRenderedHtml();
    expect(result).toHaveProperHtmlStructure();
    expect(result).toContainHtmlElement('div');
  });

  test('has widget metadata', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather', { location: 'Sydney' });

    expect(result).toBeSuccessful();
    expect(result).toHaveWidgetMetadata();
  });

  test('handles special characters safely (XSS prevention)', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather', {
      location: '<script>alert("xss")</script>',
    });

    expect(result).toBeSuccessful();
    expect(result).toBeXssSafe();
    expect(result).toNotContainRawContent('<script>');
  });

  test('renders weather data for known cities', async ({ mcp }) => {
    // Test with a city that has mock data
    const result = await mcp.tools.call('get_weather', { location: 'San Francisco' });

    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml();

    const output = result.json<WeatherOutput>();
    expect(output.conditions).toBe('foggy');
    expect(result).toContainBoundValue('San Francisco');
    expect(result).toContainBoundValue(18); // Mock temperature
  });

  test('supports temperature unit conversion', async ({ mcp }) => {
    const celsiusResult = await mcp.tools.call('get_weather', {
      location: 'New York',
      units: 'celsius',
    });
    const fahrenheitResult = await mcp.tools.call('get_weather', {
      location: 'New York',
      units: 'fahrenheit',
    });

    expect(celsiusResult).toBeSuccessful();
    expect(fahrenheitResult).toBeSuccessful();

    const celsiusOutput = celsiusResult.json<WeatherOutput>();
    const fahrenheitOutput = fahrenheitResult.json<WeatherOutput>();

    // Same location should have same conditions but different temperature values
    expect(celsiusOutput.conditions).toBe(fahrenheitOutput.conditions);
    expect(celsiusOutput.units).toBe('celsius');
    expect(fahrenheitOutput.units).toBe('fahrenheit');
    // Fahrenheit should be higher for positive Celsius temps
    expect(fahrenheitOutput.temperature).toBeGreaterThan(celsiusOutput.temperature);
  });

  test('binds all output fields correctly', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather', { location: 'London' });

    expect(result).toBeSuccessful();
    const html = UIAssertions.assertRenderedUI(result);

    // Use comprehensive data binding assertion
    const output = result.json<WeatherOutput>();
    UIAssertions.assertDataBinding(html, output as unknown as Record<string, unknown>, [
      'location',
      'temperature',
      'conditions',
      'humidity',
      'windSpeed',
    ]);
  });

  test('React component renders without fallback', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather', { location: 'Paris' });

    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml();
    // Should not contain mdx-fallback class (which indicates rendering failure)
    expect(result).toNotContainRawContent('mdx-fallback');
    // Should not contain raw React component syntax
    expect(result).toNotContainRawContent('WeatherCard');
  });
});
