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

  it('should safely escape toolName containing script-breaking characters', () => {
    const malicious = '</script><script>alert("xss")</script>';
    const result = buildDataInjectionScript({ toolName: malicious });
    // The raw </script> must not appear unescaped inside the script body
    // (safeJsonForScript escapes </ to <\/ to prevent tag breakout)
    const body = result.replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
    expect(body).not.toContain('</script>');
    // The value should be safely serialized
    expect(result).toContain('window.__mcpToolName');
    // The outer wrapper must have exactly one script open/close
    expect(result.startsWith('<script>')).toBe(true);
    expect(result.endsWith('</script>')).toBe(true);
  });

  it('should safely escape output containing script-breaking characters', () => {
    const result = buildDataInjectionScript({
      toolName: 'test',
      output: { payload: '</script><img onerror=alert(1) src=x>' },
    });
    expect(result).not.toContain('</script><img');
    const scriptCloseCount = (result.match(/<\/script>/g) || []).length;
    expect(scriptCloseCount).toBe(1);
  });
});
