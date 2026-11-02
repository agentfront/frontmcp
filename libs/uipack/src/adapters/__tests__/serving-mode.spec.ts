import { resolveServingMode } from '../serving-mode';

describe('resolveServingMode', () => {
  it('keeps structuredContent for Codex, as for the generic MCP clients it was detected as before', () => {
    expect(resolveServingMode({ configuredMode: 'auto', platformType: 'codex' })).toMatchObject({
      supportsUI: true,
      effectiveMode: 'inline',
      useStructuredContent: true,
    });
  });

  it('answers Claude Code as the other Claude clients', () => {
    const claude = resolveServingMode({ configuredMode: 'auto', platformType: 'claude' });
    const claudeCode = resolveServingMode({ configuredMode: 'auto', platformType: 'claude-code' });
    expect(claudeCode.useStructuredContent).toBe(claude.useStructuredContent);
    expect(claudeCode.effectiveMode).toBe(claude.effectiveMode);
  });
});
