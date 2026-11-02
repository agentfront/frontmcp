import { findBudgetOverruns, lintServerManifest } from '../manifest-lint';
import { SERVER_MANIFEST_VERSION, type ServerManifest } from '../server-manifest.schema';

function manifest(extra: Partial<ServerManifest> = {}): ServerManifest {
  return {
    manifestVersion: SERVER_MANIFEST_VERSION,
    server: { name: 'lint-demo', version: '1.0.0', instructions: 'Short.' },
    budget: { instructions: 40, toolDescription: 20 },
    apps: [],
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    skills: [],
    ...extra,
  };
}

const tool = (name: string, description?: string, visibility: 'public' | 'hidden' = 'public') => ({
  name,
  description,
  owner: 'app:demo',
  inputSchema: { type: 'object' },
  visibility,
});

describe('lintServerManifest()', () => {
  it('finds nothing in a described server within its budget', () => {
    expect(lintServerManifest(manifest({ tools: [tool('add', 'Add numbers')] }))).toEqual([]);
  });

  it('reports every listed entry without a description', () => {
    const findings = lintServerManifest(
      manifest({
        tools: [tool('add', '  '), tool('secret', undefined, 'hidden')],
        resources: [{ uri: 'docs://readme', name: 'readme', owner: 'app:demo' }],
        resourceTemplates: [{ uriTemplate: 'items://{id}', name: 'item', owner: 'app:demo' }],
        prompts: [{ name: 'review', owner: 'app:demo' }],
        skills: [
          { name: 'quiet', path: 'quiet', description: '', owner: 'app:demo', visibility: 'both', tools: [] },
          {
            name: 'tucked',
            path: 'tucked',
            description: '',
            owner: 'app:demo',
            visibility: 'both',
            hidden: true,
            tools: [],
          },
        ],
      }),
    );

    expect(findings).toEqual([
      { rule: 'missing-description', entry: { kind: 'tool', name: 'add' }, message: 'Tool "add" has no description.' },
      {
        rule: 'missing-description',
        entry: { kind: 'resource', name: 'docs://readme' },
        message: 'Resource "docs://readme" has no description.',
      },
      {
        rule: 'missing-description',
        entry: { kind: 'resourceTemplate', name: 'items://{id}' },
        message: 'Resource template "items://{id}" has no description.',
      },
      {
        rule: 'missing-description',
        entry: { kind: 'prompt', name: 'review' },
        message: 'Prompt "review" has no description.',
      },
      {
        rule: 'missing-description',
        entry: { kind: 'skill', name: 'quiet' },
        message: 'Skill "quiet" has no description.',
      },
    ]);
  });

  it('reports instructions and listed tool descriptions over the budget', () => {
    const findings = lintServerManifest(
      manifest({
        server: { name: 'lint-demo', version: '1.0.0', instructions: 'x'.repeat(41) },
        tools: [tool('long', 'y'.repeat(21)), tool('hidden_long', 'z'.repeat(50), 'hidden')],
      }),
    );

    expect(findings.map((finding) => finding.rule)).toEqual(['instructions-over-budget', 'description-over-budget']);
    expect(findings[0].message).toContain(
      'The initialize instructions are 41 characters, over the instructionsBudget of 40',
    );
    expect(findings[1]).toEqual({
      rule: 'description-over-budget',
      entry: { kind: 'tool', name: 'long' },
      message: 'Tool "long" has a 21-character description, over the instructionsBudget.toolDescription of 20.',
    });
  });

  it('skips the budget when it is off', () => {
    const { budget: _budget, ...withoutBudget } = manifest({
      server: { name: 'lint-demo', version: '1.0.0', instructions: 'x'.repeat(500) },
    });

    expect(lintServerManifest(withoutBudget)).toEqual([]);
  });
});

describe('findBudgetOverruns()', () => {
  it('treats missing instructions and descriptions as empty', () => {
    expect(findBudgetOverruns({ tools: [{ name: 'bare' }] }, { instructions: 1, toolDescription: 1 })).toEqual([]);
  });
});
