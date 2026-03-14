import { createRouterEntries } from '../router.entries';
import { NavigateTool } from '../navigate.tool';
import { GoBackTool } from '../go-back.tool';
import { CurrentRouteResource } from '../current-route.resource';

describe('createRouterEntries', () => {
  it('returns NavigateTool and GoBackTool in tools array', () => {
    const { tools } = createRouterEntries();

    expect(tools).toHaveLength(2);
    expect(tools[0]).toBe(NavigateTool);
    expect(tools[1]).toBe(GoBackTool);
  });

  it('returns CurrentRouteResource in resources array', () => {
    const { resources } = createRouterEntries();

    expect(resources).toHaveLength(1);
    expect(resources[0]).toBe(CurrentRouteResource);
  });

  it('returns a new object on each call', () => {
    const entries1 = createRouterEntries();
    const entries2 = createRouterEntries();

    expect(entries1).not.toBe(entries2);
    expect(entries1.tools).not.toBe(entries2.tools);
    expect(entries1.resources).not.toBe(entries2.resources);
  });

  it('returned entries have expected shape', () => {
    const entries = createRouterEntries();

    expect(entries).toHaveProperty('tools');
    expect(entries).toHaveProperty('resources');
    expect(Array.isArray(entries.tools)).toBe(true);
    expect(Array.isArray(entries.resources)).toBe(true);
  });

  it('tools have correct toolName properties', () => {
    const { tools } = createRouterEntries();

    expect(tools[0].toolName).toBe('navigate');
    expect(tools[1].toolName).toBe('go_back');
  });

  it('resource has correct uri property', () => {
    const { resources } = createRouterEntries();

    expect(resources[0].uri).toBe('route://current');
  });
});
