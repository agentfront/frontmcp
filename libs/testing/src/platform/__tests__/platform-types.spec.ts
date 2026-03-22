import {
  getPlatformMetaNamespace,
  getPlatformMimeType,
  isOpenAIPlatform,
  isExtAppsPlatform,
  isUiPlatform,
  getToolsListMetaPrefixes,
  getToolCallMetaPrefixes,
  getForbiddenMetaPrefixes,
} from '../platform-types';
import type { TestPlatformType } from '../platform-types';

const ALL_PLATFORMS: TestPlatformType[] = [
  'openai',
  'ext-apps',
  'claude',
  'cursor',
  'continue',
  'cody',
  'gemini',
  'generic-mcp',
  'unknown',
];

describe('getPlatformMetaNamespace', () => {
  it('should return "ui" for every platform', () => {
    for (const platform of ALL_PLATFORMS) {
      expect(getPlatformMetaNamespace(platform)).toBe('ui');
    }
  });
});

describe('getPlatformMimeType', () => {
  it('should return "text/html;profile=mcp-app" for every platform', () => {
    for (const platform of ALL_PLATFORMS) {
      expect(getPlatformMimeType(platform)).toBe('text/html;profile=mcp-app');
    }
  });
});

describe('isOpenAIPlatform', () => {
  it('should return true only for "openai"', () => {
    expect(isOpenAIPlatform('openai')).toBe(true);
  });

  it('should return false for all other platforms', () => {
    for (const platform of ALL_PLATFORMS.filter((p) => p !== 'openai')) {
      expect(isOpenAIPlatform(platform)).toBe(false);
    }
  });
});

describe('isExtAppsPlatform', () => {
  it('should return true only for "ext-apps"', () => {
    expect(isExtAppsPlatform('ext-apps')).toBe(true);
  });

  it('should return false for all other platforms', () => {
    for (const platform of ALL_PLATFORMS.filter((p) => p !== 'ext-apps')) {
      expect(isExtAppsPlatform(platform)).toBe(false);
    }
  });
});

describe('isUiPlatform', () => {
  it('should return true for every platform', () => {
    for (const platform of ALL_PLATFORMS) {
      expect(isUiPlatform(platform)).toBe(true);
    }
  });
});

describe('getToolsListMetaPrefixes', () => {
  it('should return ["ui/"] for every platform', () => {
    for (const platform of ALL_PLATFORMS) {
      expect(getToolsListMetaPrefixes(platform)).toEqual(['ui/']);
    }
  });
});

describe('getToolCallMetaPrefixes', () => {
  it('should return ["ui/"] for every platform', () => {
    for (const platform of ALL_PLATFORMS) {
      expect(getToolCallMetaPrefixes(platform)).toEqual(['ui/']);
    }
  });
});

describe('getForbiddenMetaPrefixes', () => {
  it('should return ["openai/", "frontmcp/"] for every platform', () => {
    for (const platform of ALL_PLATFORMS) {
      expect(getForbiddenMetaPrefixes(platform)).toEqual(['openai/', 'frontmcp/']);
    }
  });
});
