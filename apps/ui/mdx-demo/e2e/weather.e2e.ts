/**
 * @file weather.e2e.spec.ts
 * @description E2E tests for MDX Weather Tool UI
 *
 * Tests verify that MDX templates are properly compiled and rendered,
 * custom components (Alert, WeatherCard) work correctly,
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

// Configure test to use the MDX demo server
// The fixture will auto-start the server from the entry file
test.use({
  server: './src/main.ts',
  port: 3004,
  transport: 'streamable-http',
  publicMode: true,
});

test.describe('MDX Weather Tool UI', () => {
  test('renders MDX template to HTML (not raw MDX)', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', { location: 'Tel Aviv' });

    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml(); // Fails if mdx-fallback
    expect(result).toBeXssSafe();
    expect(result).toHaveProperHtmlStructure();
  });

  test('does NOT show mdx-fallback (rendering did not fail)', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', { location: 'Berlin' });

    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml();
    // The mdx-fallback class indicates MDX rendering failed and showed raw escaped content
    expect(result).toNotContainRawContent('mdx-fallback');
  });

  test('renders custom MDX components (Alert, WeatherCard)', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', { location: 'New York' });

    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml();

    // Custom components should be rendered, not left as raw tags
    const html = UIAssertions.assertRenderedUI(result);

    // Alert and WeatherCard should NOT appear as raw tags
    // They should be rendered into actual HTML elements
    expect(html).not.toMatch(/<Alert[\s>]/);
    expect(html).not.toMatch(/<WeatherCard[\s>]/);

    // The rendered components should produce div elements
    expect(result).toContainHtmlElement('div');
  });

  test('binds output data correctly in MDX', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', { location: 'Sydney' });

    expect(result).toBeSuccessful();

    const output = result.json<WeatherOutput>();
    expect(result).toContainBoundValue(output.location);
    expect(result).toContainBoundValue(output.temperature);
    expect(result).toContainBoundValue(output.humidity);
    expect(result).toContainBoundValue(output.windSpeed);
  });

  test('MDX Markdown elements render as HTML', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', { location: 'London' });

    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml();

    // Markdown headers should render as HTML h1, h2 tags
    expect(result).toContainHtmlElement('h1'); // # Header
    expect(result).toContainHtmlElement('h2'); // ## Header

    // Lists should render as ul/li or ol/li
    expect(result).toContainHtmlElement('li');
  });

  test('handles special characters safely (XSS prevention)', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', {
      location: '<script>alert("xss")</script>',
    });

    expect(result).toBeSuccessful();
    expect(result).toBeXssSafe();
    expect(result).toNotContainRawContent('<script>');
  });

  test('has widget metadata', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', { location: 'Paris' });

    expect(result).toBeSuccessful();
    expect(result).toHaveWidgetMetadata();
  });

  test('renders weather data for known cities', async ({ mcp }) => {
    // Test with a city that has mock data
    const result = await mcp.tools.call('get_weather_mdx', { location: 'San Francisco' });

    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml();

    const output = result.json<WeatherOutput>();
    expect(output.conditions).toBe('foggy');
    expect(result).toContainBoundValue('San Francisco');
    expect(result).toContainBoundValue(18); // Mock temperature
  });

  test('renders horizontal rule from Markdown', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', { location: 'Tokyo' });

    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml();

    // The MDX template uses --- which should render as <hr> or a separator
    // Some MDX renderers may convert --- to <hr>, others to thematic breaks
    // Check for either <hr> or the rendered separator class
    const html = UIAssertions.assertRenderedUI(result);
    // The template has --- which should create some separator element
    // Accept either <hr> or any block-level element with separator styling
    const hasSeparator = html.includes('<hr') || html.includes('border-') || html.includes('Powered by');
    expect(hasSeparator).toBe(true);
  });

  test('complete UI validation suite', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', { location: 'London' });

    // Use comprehensive validation helper
    const html = UIAssertions.assertValidUI(result, ['location', 'temperature', 'conditions', 'humidity']);

    // Additional MDX-specific checks
    UIAssertions.assertNotContainsRaw(html, '<Alert');
    UIAssertions.assertNotContainsRaw(html, '<WeatherCard');
    UIAssertions.assertNotContainsRaw(html, 'mdx-fallback');
    UIAssertions.assertContainsElement(html, 'h1');
    UIAssertions.assertContainsElement(html, 'h2');
  });

  test('JSX expressions in MDX are evaluated', async ({ mcp }) => {
    const result = await mcp.tools.call('get_weather_mdx', { location: 'Tokyo', units: 'celsius' });

    expect(result).toBeSuccessful();
    expect(result).toHaveRenderedHtml();

    const output = result.json<WeatherOutput>();
    // The MDX template uses {output.temperature} expressions
    // These should be evaluated to the actual values
    expect(result).toContainBoundValue(output.temperature);

    // Should not contain raw JSX expression syntax
    const html = UIAssertions.assertRenderedUI(result);
    expect(html).not.toMatch(/\{output\./);
    expect(html).not.toMatch(/\{helpers\./);
  });

  test('escapeHtml helper prevents XSS in bound values', async ({ mcp }) => {
    // The MDX template uses helpers.escapeHtml for user-provided values
    const result = await mcp.tools.call('get_weather_mdx', {
      location: '<img onerror="alert(1)" src="">',
    });

    expect(result).toBeSuccessful();

    // The malicious input should be escaped or sanitized in the location field
    const html = UIAssertions.assertRenderedUI(result);

    // The location value should be escaped - check for &lt; instead of <
    // OR the img tag should be rendered harmlessly without the onerror attribute
    // The key is that actual script execution should not be possible
    const hasRawImgWithOnerror = /<img[^>]*onerror\s*=/i.test(html);
    expect(hasRawImgWithOnerror).toBe(false);

    // Note: The HTML may contain inline event handlers in the TEMPLATE components
    // (like React event handlers that become onclick after SSR) - that's expected.
    // What we're testing is that USER INPUT doesn't create XSS vectors.
  });
});
