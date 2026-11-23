import { argumentIssuesOf } from '../review/input-schema-check';

const schema = {
  type: 'object',
  properties: {
    limit: { type: 'number' },
    page: { type: 'integer' },
    active: { type: 'boolean' },
    name: { type: 'string' },
    status: { type: 'string', enum: ['open', 'closed'] },
    owner: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    tier: { anyOf: [{ type: 'string', enum: ['gold', 'silver'] }, { type: 'null' }] },
    tags: { type: ['array', 'null'] },
    anything: {},
  },
  required: ['name'],
};

describe('argumentIssuesOf', () => {
  it('accepts arguments that match their schemas, and ignores arguments the schema does not list', () => {
    expect(
      argumentIssuesOf(
        {
          limit: 2.5,
          page: 3,
          active: true,
          name: 'ada',
          status: 'open',
          owner: null,
          tier: 'gold',
          tags: null,
          anything: { a: 1 },
          extra: 1,
        },
        schema,
        true,
      ),
    ).toEqual([]);
  });

  it('suggests the literal the agent meant for a number, a boolean or a string of the wrong type', () => {
    expect(argumentIssuesOf({ limit: '20', active: 'false', name: 7 }, schema, true)).toEqual([
      { argument: 'limit', message: '"limit" must be a number, not a string', suggestion: 'limit: 20' },
      { argument: 'active', message: '"active" must be a boolean, not a string', suggestion: 'active: false' },
      { argument: 'name', message: '"name" must be a string, not a number', suggestion: 'name: "7"' },
    ]);
  });

  it('names the types and gives no suggestion when the value cannot be the one meant', () => {
    expect(argumentIssuesOf({ page: 1.5, limit: 'many', owner: 3, tags: {} }, schema, false)).toEqual([
      { argument: 'page', message: '"page" must be an integer, not a number' },
      { argument: 'limit', message: '"limit" must be a number, not a string' },
      { argument: 'owner', message: '"owner" must be a string or null, not a number', suggestion: 'owner: "3"' },
      { argument: 'tags', message: '"tags" must be an array or null, not an object' },
    ]);
  });

  it('lists the allowed values of an enum, also inside anyOf', () => {
    expect(argumentIssuesOf({ status: 'archived', tier: 'bronze' }, schema, false)).toEqual([
      { argument: 'status', message: '"status" must be one of "open", "closed"' },
      { argument: 'tier', message: '"tier" must be one of "gold", "silver"' },
    ]);
  });

  it('reports a missing required argument only when every argument is known', () => {
    expect(argumentIssuesOf({}, schema, true)).toEqual([{ argument: 'name', message: '"name" is required' }]);
    expect(argumentIssuesOf({}, schema, false)).toEqual([]);
  });

  it('checks nothing without a schema, or for a schema with no properties', () => {
    expect(argumentIssuesOf({ limit: '20' }, null, true)).toEqual([]);
    expect(argumentIssuesOf({ limit: '20' }, { type: 'object' }, true)).toEqual([]);
  });

  it('suggests nothing for a blank string where a number is wanted', () => {
    expect(argumentIssuesOf({ limit: ' ' }, schema, false)).toEqual([
      { argument: 'limit', message: '"limit" must be a number, not a string' },
    ]);
  });
});
