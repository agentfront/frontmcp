/**
 * projectConsentTools — shared scope→consent projection used by BOTH the
 * authorize flow (to seed availableToolIds) and the callback/provider-callback
 * flows (to render the screen + validate). Guarantees the offered set and the
 * enforcement set use the SAME effective tool ids and that `excludedTools` are
 * filtered out.
 */
import 'reflect-metadata';

import { createMockScopeEntry } from '../../__test-utils__';
import { projectConsentTools } from '../consent-tools.helper';

describe('projectConsentTools', () => {
  const TOOLS = [
    { id: 'notes:create', name: 'Create Note', description: 'Create a note' },
    { id: 'notes:list', name: 'List Notes', description: 'List notes' },
    { id: 'tasks:add', name: 'Add Task' },
  ];

  it('projects every scope tool into a card + available id when nothing is excluded', () => {
    const scope = createMockScopeEntry({ apps: [{ id: 'notes', name: 'Notes' }], tools: TOOLS });
    const { toolCards, availableToolIds } = projectConsentTools(scope);

    expect(availableToolIds).toEqual(['notes:create', 'notes:list', 'tasks:add']);
    expect(toolCards.map((c) => c.toolName)).toEqual(['Create Note', 'List Notes', 'Add Task']);
    // Descriptions carry through.
    expect(toolCards[0].description).toBe('Create a note');
  });

  it('omits excludedTools from both the cards and the available ids', () => {
    const scope = createMockScopeEntry({ apps: [{ id: 'notes', name: 'Notes' }], tools: TOOLS });
    const { toolCards, availableToolIds } = projectConsentTools(scope, ['notes:list']);

    expect(availableToolIds).toEqual(['notes:create', 'tasks:add']);
    expect(toolCards.find((c) => c.toolId === 'notes:list')).toBeUndefined();
    expect(toolCards).toHaveLength(2);
  });

  it('resolves the app display name from the tool owner id when available', () => {
    // The mock tools have no `owner`, so the helper falls back to the 'app' id;
    // resolve the app name when the owner id matches a registered app.
    const scope = createMockScopeEntry({ apps: [{ id: 'app', name: 'Default App' }], tools: TOOLS });
    const { toolCards } = projectConsentTools(scope);
    expect(toolCards[0].appName).toBe('Default App');
  });

  it('uses metadata.name as the effective id when metadata.id is absent', () => {
    const scope = createMockScopeEntry({
      apps: [{ id: 'app', name: 'App' }],
      tools: [{ name: 'bare_tool' } as any],
    });
    const { availableToolIds } = projectConsentTools(scope);
    expect(availableToolIds).toEqual(['bare_tool']);
  });

  it('returns empty projections for a scope with no tools', () => {
    const scope = createMockScopeEntry({ apps: [], tools: [] });
    const { toolCards, availableToolIds } = projectConsentTools(scope);
    expect(toolCards).toEqual([]);
    expect(availableToolIds).toEqual([]);
  });
});
