import { buildDataInjectionScript } from '../data-injector';

describe('buildDataInjectionScript', () => {
  it('should include __mcpAppsEnabled flag', () => {
    const result = buildDataInjectionScript({ toolName: 'test' });
    expect(result).toContain('window.__mcpAppsEnabled = true');
  });

  it('should place __mcpAppsEnabled before __mcpToolName', () => {
    const result = buildDataInjectionScript({ toolName: 'test' });
    const appsIdx = result.indexOf('__mcpAppsEnabled');
    const toolIdx = result.indexOf('__mcpToolName');
    expect(appsIdx).toBeGreaterThan(-1);
    expect(toolIdx).toBeGreaterThan(-1);
    expect(appsIdx).toBeLessThan(toolIdx);
  });

  it('should inject tool name', () => {
    const result = buildDataInjectionScript({ toolName: 'my_tool' });
    expect(result).toContain('window.__mcpToolName = "my_tool"');
  });

  it('should inject input, output, and structuredContent as null by default', () => {
    const result = buildDataInjectionScript({ toolName: 'test' });
    expect(result).toContain('window.__mcpToolInput = null');
    expect(result).toContain('window.__mcpToolOutput = null');
    expect(result).toContain('window.__mcpStructuredContent = null');
  });

  it('should inject provided output data', () => {
    const result = buildDataInjectionScript({
      toolName: 'test',
      output: { temperature: 18 },
    });
    expect(result).toContain('window.__mcpToolOutput = {"temperature":18}');
  });

  it('should wrap output in a script tag', () => {
    const result = buildDataInjectionScript({ toolName: 'test' });
    expect(result).toMatch(/^<script>\n[\s\S]+\n<\/script>$/);
  });
});
