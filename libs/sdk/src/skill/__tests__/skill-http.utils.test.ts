// skill/__tests__/skill-http.utils.test.ts

import {
  formatSkillsForLlmCompact,
  formatSkillForLLMWithSchemas,
  skillToApiResponse,
  filterSkillsByVisibility,
} from '../skill-http.utils';
import type { SkillEntry } from '../../common';
import type { SkillContent } from '../../common/interfaces';

// Mock SkillEntry for testing
function createMockSkillEntry(
  overrides: Partial<{
    name: string;
    metadata: Partial<SkillEntry['metadata']>;
    toolNames: string[];
  }>,
): SkillEntry {
  const defaults = {
    name: 'test-skill',
    metadata: {
      id: 'test-skill-id',
      name: 'test-skill',
      description: 'A test skill',
      tags: ['test', 'mock'],
      priority: 0,
      visibility: 'both' as const,
      parameters: [],
      hideFromDiscovery: false,
      toolValidation: 'warn' as const,
      instructions: 'Test instructions',
    },
    toolNames: ['tool1', 'tool2'],
  };

  const merged = { ...defaults, ...overrides };
  merged.metadata = { ...defaults.metadata, ...overrides.metadata };

  return {
    name: merged.name,
    metadata: merged.metadata as SkillEntry['metadata'],
    getToolNames: () => merged.toolNames,
    isHidden: () => merged.metadata.hideFromDiscovery ?? false,
  } as unknown as SkillEntry;
}

// Mock SkillContent for testing
function createMockSkillContent(overrides: Partial<SkillContent> = {}): SkillContent {
  return {
    id: 'test-skill-id',
    name: 'test-skill',
    description: 'A test skill description',
    instructions: 'Step 1: Do this\nStep 2: Do that',
    tools: [
      { name: 'tool1', purpose: 'First tool purpose' },
      { name: 'tool2', purpose: 'Second tool purpose' },
    ],
    parameters: [{ name: 'param1', description: 'First parameter', required: true, type: 'string' }],
    examples: [{ scenario: 'Example scenario', expectedOutcome: 'Expected result' }],
    ...overrides,
  };
}

// Mock ToolRegistryInterface for testing
function createMockToolRegistry(
  tools: Array<{
    name: string;
    rawInputSchema?: unknown;
    rawOutputSchema?: unknown;
  }>,
) {
  return {
    getTools: (includeHidden?: boolean) =>
      tools.map((t) => ({
        name: t.name,
        rawInputSchema: t.rawInputSchema,
        rawOutputSchema: t.rawOutputSchema,
        getRawOutputSchema: () => t.rawOutputSchema,
        getInputJsonSchema: () => t.rawInputSchema ?? null,
      })),
  };
}

describe('formatSkillsForLlmCompact', () => {
  it('should format a single skill correctly', () => {
    const skills = [
      createMockSkillEntry({
        name: 'review-pr',
        metadata: {
          name: 'review-pr',
          description: 'Review a pull request',
          tags: ['github', 'code-review'],
        },
        toolNames: ['github_get_pr', 'github_add_comment'],
      }),
    ];

    const result = formatSkillsForLlmCompact(skills);

    expect(result).toContain('# review-pr');
    expect(result).toContain('Review a pull request');
    expect(result).toContain('Tools: github_get_pr, github_add_comment');
    expect(result).toContain('Tags: github, code-review');
  });

  it('should format multiple skills with separator', () => {
    const skills = [
      createMockSkillEntry({
        name: 'skill1',
        metadata: { name: 'skill1', description: 'First skill' },
      }),
      createMockSkillEntry({
        name: 'skill2',
        metadata: { name: 'skill2', description: 'Second skill' },
      }),
    ];

    const result = formatSkillsForLlmCompact(skills);

    expect(result).toContain('# skill1');
    expect(result).toContain('# skill2');
    expect(result).toContain('---');
  });

  it('should handle skills without tools', () => {
    const skills = [
      createMockSkillEntry({
        name: 'no-tools',
        metadata: { name: 'no-tools', description: 'Skill without tools' },
        toolNames: [],
      }),
    ];

    const result = formatSkillsForLlmCompact(skills);

    expect(result).toContain('# no-tools');
    expect(result).not.toContain('Tools:');
  });

  it('should handle skills without tags', () => {
    const skills = [
      createMockSkillEntry({
        name: 'no-tags',
        metadata: { name: 'no-tags', description: 'Skill without tags', tags: [] },
      }),
    ];

    const result = formatSkillsForLlmCompact(skills);

    expect(result).toContain('# no-tags');
    expect(result).not.toContain('Tags:');
  });

  it('should return empty string for empty skills array', () => {
    const result = formatSkillsForLlmCompact([]);
    expect(result).toBe('');
  });

  it('should include license in compact output when present', () => {
    const skills = [
      createMockSkillEntry({
        name: 'licensed-skill',
        metadata: {
          name: 'licensed-skill',
          description: 'Skill with license',
          license: 'MIT',
        },
      }),
    ];

    const result = formatSkillsForLlmCompact(skills);

    expect(result).toContain('License: MIT');
  });
});

describe('formatSkillForLLMWithSchemas', () => {
  it('should format skill with available tools and schemas', () => {
    const skill = createMockSkillContent();
    const availableTools = ['tool1', 'tool2'];
    const missingTools: string[] = [];
    const toolRegistry = createMockToolRegistry([
      {
        name: 'tool1',
        rawInputSchema: { type: 'object', properties: { input: { type: 'string' } } },
        rawOutputSchema: { type: 'object', properties: { output: { type: 'string' } } },
      },
      {
        name: 'tool2',
        rawInputSchema: { type: 'object', properties: { data: { type: 'number' } } },
      },
    ]);

    const result = formatSkillForLLMWithSchemas(skill, availableTools, missingTools, toolRegistry as any);

    expect(result).toContain('# Skill: test-skill');
    expect(result).toContain('A test skill description');
    expect(result).toContain('## Tools');
    expect(result).toContain('[✓] tool1');
    expect(result).toContain('[✓] tool2');
    expect(result).toContain('**Input Schema:**');
    expect(result).toContain('"type": "object"');
    expect(result).toContain('## Instructions');
    expect(result).toContain('Step 1: Do this');
  });

  it('should show warning for missing tools', () => {
    const skill = createMockSkillContent();
    const availableTools = ['tool1'];
    const missingTools = ['tool2'];
    const toolRegistry = createMockToolRegistry([{ name: 'tool1', rawInputSchema: { type: 'object' } }]);

    const result = formatSkillForLLMWithSchemas(skill, availableTools, missingTools, toolRegistry as any);

    expect(result).toContain('**Warning:**');
    expect(result).toContain('Missing: tool2');
    expect(result).toContain('[✓] tool1');
    expect(result).toContain('[✗] tool2');
  });

  it('should include parameters section', () => {
    const skill = createMockSkillContent({
      parameters: [
        { name: 'repo', description: 'Repository name', required: true, type: 'string' },
        { name: 'branch', description: 'Branch name', required: false, type: 'string' },
      ],
    });
    const toolRegistry = createMockToolRegistry([]);

    const result = formatSkillForLLMWithSchemas(skill, [], [], toolRegistry as any);

    expect(result).toContain('## Parameters');
    expect(result).toContain('**repo** (required)');
    expect(result).toContain('**branch**');
  });

  it('should include examples section', () => {
    const skill = createMockSkillContent({
      examples: [{ scenario: 'Review a simple PR', expectedOutcome: 'PR is reviewed with comments' }],
    });
    const toolRegistry = createMockToolRegistry([]);

    const result = formatSkillForLLMWithSchemas(skill, [], [], toolRegistry as any);

    expect(result).toContain('## Examples');
    expect(result).toContain('### Review a simple PR');
    expect(result).toContain('Expected outcome: PR is reviewed with comments');
  });

  it('should handle skill without parameters', () => {
    const skill = createMockSkillContent({ parameters: undefined });
    const toolRegistry = createMockToolRegistry([]);

    const result = formatSkillForLLMWithSchemas(skill, [], [], toolRegistry as any);

    expect(result).not.toContain('## Parameters');
  });

  it('should handle skill without examples', () => {
    const skill = createMockSkillContent({ examples: undefined });
    const toolRegistry = createMockToolRegistry([]);

    const result = formatSkillForLLMWithSchemas(skill, [], [], toolRegistry as any);

    expect(result).not.toContain('## Examples');
  });

  it('should include license and compatibility in output', () => {
    const skill = createMockSkillContent({
      license: 'MIT',
      compatibility: 'Requires Node.js 18+',
    });
    const toolRegistry = createMockToolRegistry([]);

    const result = formatSkillForLLMWithSchemas(skill, [], [], toolRegistry as any);

    expect(result).toContain('**License:** MIT');
    expect(result).toContain('**Compatibility:** Requires Node.js 18+');
  });

  it('should not include license/compatibility when not present', () => {
    const skill = createMockSkillContent({ license: undefined, compatibility: undefined });
    const toolRegistry = createMockToolRegistry([]);

    const result = formatSkillForLLMWithSchemas(skill, [], [], toolRegistry as any);

    expect(result).not.toContain('**License:**');
    expect(result).not.toContain('**Compatibility:**');
  });
});

describe('skillToApiResponse', () => {
  it('should convert skill entry to API response', () => {
    const skill = createMockSkillEntry({
      name: 'test-skill',
      metadata: {
        id: 'skill-123',
        name: 'test-skill',
        description: 'A test skill',
        tags: ['test'],
        priority: 5,
        visibility: 'both',
        parameters: [{ name: 'param1', description: 'First param', required: true, type: 'string' }],
      },
      toolNames: ['tool1'],
    });

    const result = skillToApiResponse(skill);

    expect(result.id).toBe('skill-123');
    expect(result.name).toBe('test-skill');
    expect(result.description).toBe('A test skill');
    expect(result.tags).toEqual(['test']);
    expect(result.tools).toEqual(['tool1']);
    expect(result.priority).toBe(5);
    expect(result.visibility).toBe('both');
    expect(result.parameters).toHaveLength(1);
    expect(result.parameters?.[0].name).toBe('param1');
  });

  it('should use name as id when id is not set', () => {
    const skill = createMockSkillEntry({
      name: 'my-skill',
      metadata: { id: undefined, name: 'my-skill', description: 'desc' },
    });

    const result = skillToApiResponse(skill);

    expect(result.id).toBe('my-skill');
  });

  it('should include load result info when provided', () => {
    const skill = createMockSkillEntry({});
    const loadResult = {
      availableTools: ['tool1'],
      missingTools: ['tool2'],
      isComplete: false,
    };

    const result = skillToApiResponse(skill, loadResult);

    expect(result.availableTools).toEqual(['tool1']);
    expect(result.missingTools).toEqual(['tool2']);
    expect(result.isComplete).toBe(false);
  });

  it('should default visibility to both', () => {
    const skill = createMockSkillEntry({
      metadata: { visibility: undefined },
    });

    const result = skillToApiResponse(skill);

    expect(result.visibility).toBe('both');
  });

  it('should include new spec fields in API response', () => {
    const skill = createMockSkillEntry({
      metadata: {
        name: 'spec-skill',
        description: 'Spec skill',
        license: 'Apache-2.0',
        compatibility: 'Node.js 20+',
        specMetadata: { author: 'alice', version: '2.0' },
        allowedTools: 'Read Edit Bash(git status)',
      },
    });

    const result = skillToApiResponse(skill);

    expect(result.license).toBe('Apache-2.0');
    expect(result.compatibility).toBe('Node.js 20+');
    expect(result.specMetadata).toEqual({ author: 'alice', version: '2.0' });
    expect(result.allowedTools).toBe('Read Edit Bash(git status)');
  });

  it('should leave new spec fields undefined when not set', () => {
    const skill = createMockSkillEntry({});

    const result = skillToApiResponse(skill);

    expect(result.license).toBeUndefined();
    expect(result.compatibility).toBeUndefined();
    expect(result.specMetadata).toBeUndefined();
    expect(result.allowedTools).toBeUndefined();
  });

  it('should handle empty tags', () => {
    const skill = createMockSkillEntry({
      metadata: { tags: undefined },
    });

    const result = skillToApiResponse(skill);

    expect(result.tags).toEqual([]);
  });
});

describe('filterSkillsByVisibility', () => {
  it('should filter skills for MCP context', () => {
    const skills = [
      createMockSkillEntry({ metadata: { visibility: 'mcp' } }),
      createMockSkillEntry({ metadata: { visibility: 'http' } }),
      createMockSkillEntry({ metadata: { visibility: 'both' } }),
    ];

    const result = filterSkillsByVisibility(skills, 'mcp');

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.metadata.visibility)).toEqual(['mcp', 'both']);
  });

  it('should filter skills for HTTP context', () => {
    const skills = [
      createMockSkillEntry({ metadata: { visibility: 'mcp' } }),
      createMockSkillEntry({ metadata: { visibility: 'http' } }),
      createMockSkillEntry({ metadata: { visibility: 'both' } }),
    ];

    const result = filterSkillsByVisibility(skills, 'http');

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.metadata.visibility)).toEqual(['http', 'both']);
  });

  it('should include all skills with both visibility in any context', () => {
    const skills = [
      createMockSkillEntry({ name: 'skill1', metadata: { visibility: 'both' } }),
      createMockSkillEntry({ name: 'skill2', metadata: { visibility: 'both' } }),
    ];

    const mcpResult = filterSkillsByVisibility(skills, 'mcp');
    const httpResult = filterSkillsByVisibility(skills, 'http');

    expect(mcpResult).toHaveLength(2);
    expect(httpResult).toHaveLength(2);
  });

  it('should default undefined visibility to both', () => {
    const skills = [createMockSkillEntry({ metadata: { visibility: undefined } })];

    const mcpResult = filterSkillsByVisibility(skills, 'mcp');
    const httpResult = filterSkillsByVisibility(skills, 'http');

    expect(mcpResult).toHaveLength(1);
    expect(httpResult).toHaveLength(1);
  });

  it('should return empty array when no skills match', () => {
    const skills = [createMockSkillEntry({ metadata: { visibility: 'mcp' } })];

    const result = filterSkillsByVisibility(skills, 'http');

    expect(result).toHaveLength(0);
  });
});
