import { bundleSkillToActions, type BundledSkill, type OperationDescriptor } from '../bundle/bundle.types';

const op = (id: string): OperationDescriptor => ({
  operationId: id,
  serviceId: 'svc',
  httpMethod: 'GET',
  pathTemplate: `/${id}`,
  inputSchema: {},
  outputSchema: {},
  mapper: [],
  authBindingRef: 'def',
});

describe('bundleSkillToActions', () => {
  it('projects each operationId to a SkillAction with input/output schema', () => {
    const skill: BundledSkill = {
      id: 's',
      name: 'S',
      description: 'd',
      instructions: 'i',
      operationIds: ['a', 'b'],
    };
    const ops = { a: op('a'), b: op('b') };
    const actions = bundleSkillToActions(skill, ops);
    expect(actions.map((a) => a.actionId)).toEqual(['a', 'b']);
  });

  it('throws on operationIds that are not present in the operations map', () => {
    // Silently dropping unknown ids would advertise a skill whose actions[]
    // disagree with what run_workflow's callTool can resolve; bundle apply must reject
    // the bundle entirely instead.
    const skill: BundledSkill = {
      id: 's',
      name: 'S',
      description: 'd',
      instructions: 'i',
      operationIds: ['present', 'missing'],
    };
    const ops = { present: op('present') };
    expect(() => bundleSkillToActions(skill, ops)).toThrow(/unknown operationId "missing"/);
  });

  it('passes through optional fields (description, requiredAuthorities)', () => {
    const skill: BundledSkill = {
      id: 's',
      name: 'S',
      description: 'd',
      instructions: 'i',
      operationIds: ['a'],
    };
    const ops = {
      a: {
        ...op('a'),
        description: 'long description',
        requiredAuthorities: { roles: { all: ['admin'] } },
      },
    };
    const actions = bundleSkillToActions(skill, ops);
    expect(actions[0].description).toBe('long description');
    expect(actions[0].requiredAuthorities).toEqual({ roles: { all: ['admin'] } });
  });

  it('uses pathTemplate-derived summary when none is set', () => {
    const skill: BundledSkill = {
      id: 's',
      name: 'S',
      description: 'd',
      instructions: 'i',
      operationIds: ['a'],
    };
    const ops = { a: op('a') };
    const actions = bundleSkillToActions(skill, ops);
    expect(actions[0].summary).toBe('GET /a');
  });
});
