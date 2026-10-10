import { frontMcpMetadataSchema } from '../front-mcp.metadata';

function parseTasks(tasks: Record<string, unknown>) {
  return frontMcpMetadataSchema.safeParse({ info: { name: 'tasks-schema', version: '1.0.0' }, apps: [], tasks });
}

describe('frontMcpMetadataSchema — tasks.maxConcurrentPerSession', () => {
  it.each([1, 16, 1000])('accepts %d', (maxConcurrentPerSession) => {
    expect(parseTasks({ maxConcurrentPerSession }).success).toBe(true);
  });

  it.each([1001, 2 ** 32, Number.MAX_SAFE_INTEGER])('refuses %d, above the documented bound of 1000', (value) => {
    expect(parseTasks({ maxConcurrentPerSession: value }).success).toBe(false);
  });

  it.each([0, -1, 1.5])('refuses %d', (maxConcurrentPerSession) => {
    expect(parseTasks({ maxConcurrentPerSession }).success).toBe(false);
  });
});
