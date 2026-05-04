import { diffBundles, formatDiffSummary } from '../bundle/bundle-diff';
import type { ResolvedBundle } from '../bundle/bundle.types';

const buildBundle = (overrides: Partial<ResolvedBundle> = {}): ResolvedBundle => ({
  schemaVersion: 1,
  bundleId: 'acme:prod',
  version: '1',
  generatedAt: '2026-05-01T12:00:00.000Z',
  sourceDigest: 'a'.repeat(64),
  services: [{ id: 'svc', baseUrl: 'https://example.com' }],
  authBindings: { def: { kind: 'none' } },
  skills: [
    {
      id: 's1',
      name: 'S1',
      description: 'd',
      instructions: 'i',
      operationIds: ['o1'],
    },
  ],
  operations: {
    o1: {
      operationId: 'o1',
      serviceId: 'svc',
      httpMethod: 'GET',
      pathTemplate: '/a',
      inputSchema: {},
      outputSchema: {},
      mapper: [],
      authBindingRef: 'def',
    },
  },
  ...overrides,
});

describe('diffBundles', () => {
  it('treats undefined previous as all-added', () => {
    const next = buildBundle();
    const diff = diffBundles(undefined, next);
    expect(diff.addedSkillIds).toEqual(['s1']);
    expect(diff.addedOperationIds).toEqual(['o1']);
    expect(diff.removedSkillIds).toEqual([]);
    expect(diff.isNoOp).toBe(false);
  });

  it('detects no-op for identical bundles', () => {
    const a = buildBundle();
    const b = buildBundle();
    const diff = diffBundles(a, b);
    expect(diff.isNoOp).toBe(true);
    expect(formatDiffSummary(diff)).toBe('no-op');
  });

  it('detects added skill', () => {
    const a = buildBundle();
    const b = buildBundle({
      skills: [...a.skills, { id: 's2', name: 'S2', description: 'd', instructions: 'i', operationIds: [] }],
    });
    const diff = diffBundles(a, b);
    expect(diff.addedSkillIds).toEqual(['s2']);
  });

  it('detects removed skill', () => {
    const a = buildBundle();
    const b = buildBundle({ skills: [] });
    const diff = diffBundles(a, b);
    expect(diff.removedSkillIds).toEqual(['s1']);
  });

  it('detects changed skill (e.g. instructions text edit)', () => {
    const a = buildBundle();
    const b = buildBundle({
      skills: [{ ...a.skills[0], instructions: 'CHANGED' }],
    });
    const diff = diffBundles(a, b);
    expect(diff.changedSkillIds).toEqual(['s1']);
  });

  it('detects added operation', () => {
    const a = buildBundle();
    const b = buildBundle({
      operations: {
        ...a.operations,
        o2: {
          operationId: 'o2',
          serviceId: 'svc',
          httpMethod: 'GET',
          pathTemplate: '/b',
          inputSchema: {},
          outputSchema: {},
          authBindingRef: 'def',
        },
      },
    });
    const diff = diffBundles(a, b);
    expect(diff.addedOperationIds).toEqual(['o2']);
  });

  it('detects changed operation when input schema changes', () => {
    const a = buildBundle();
    const b = buildBundle({
      operations: {
        o1: {
          ...a.operations['o1']!,
          inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
        },
      },
    });
    const diff = diffBundles(a, b);
    expect(diff.changedOperationIds).toEqual(['o1']);
  });

  it('detects changed path template', () => {
    const a = buildBundle();
    const b = buildBundle({
      operations: {
        o1: { ...a.operations['o1']!, pathTemplate: '/changed' },
      },
    });
    const diff = diffBundles(a, b);
    expect(diff.changedOperationIds).toEqual(['o1']);
  });

  it('formats summary for non-no-op diffs', () => {
    const a = buildBundle();
    const b = buildBundle({ skills: [] });
    const diff = diffBundles(a, b);
    expect(formatDiffSummary(diff)).toContain('-1');
  });
});
